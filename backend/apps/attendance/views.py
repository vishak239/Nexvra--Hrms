import datetime

import django_filters
from django.db.models import Q
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.core.permissions import HasPermission, scope_queryset
from apps.employees.models import Employee
from apps.employees.serializers import employee_ref
from apps.organization.models import CompanySettings
from apps.tasks import rules as task_rules

from . import activity, meetings, resume, services, sessions, wfh
from .models import (
    AttendanceRecord,
    BreakSession,
    Meeting,
    OvertimeSession,
    ResumeWorkRequest,
    SyncEvent,
    WorkFromHomeRequest,
)
from .serializers import (
    AttendanceAdminSerializer,
    AttendanceRecordSerializer,
    BreakSessionSerializer,
    CheckInSerializer,
    CheckOutSerializer,
    DecisionSerializer,
    EventIdSerializer,
    HeartbeatSerializer,
    MeetingPauseSerializer,
    MeetingSerializer,
    MeetingWriteSerializer,
    NonWorkingPeriodSerializer,
    OvertimeRequestSerializer,
    OvertimeSessionSerializer,
    ResumeWorkRequestSerializer,
    SyncEventSerializer,
    SyncRequestSerializer,
    WorkFromHomeRequestSerializer,
)

# How often the browser reports activity while a session or overtime is open.
HEARTBEAT_SECONDS = 60


def today_payload(request, reconcile=True):
    """Server-authoritative work-session state for the current user (used by the UI to
    render timers and to recover a session after the browser was closed). Reading it first
    applies the time-based rules (break allowance, inactivity), so a session left open in a
    closed browser is settled even before the scheduled reconciliation runs."""
    if reconcile:
        meetings.settle_meetings()
        employee = Employee.objects.filter(user=request.user).first()
        if employee is not None:
            activity.reconcile_employee(employee, request=request)
            resume.expire_stale(employee)
    state = sessions.today_state(request.user)
    record = state["record"]
    cs = state["cs"]
    dt = serializers.DateTimeField()
    pause = state["active_pause"]
    return {
        "date": state["date"],
        "server_time": dt.to_representation(state["now"]),
        "self_attendance_enabled": cs.self_attendance_enabled,
        "break_allowance_minutes": cs.break_allowance_minutes,
        "break_used_seconds": state["break_used_seconds"],
        "break_remaining_seconds": state["break_remaining_seconds"],
        "inactivity_timeout_minutes": cs.inactivity_timeout_minutes,
        "heartbeat_seconds": HEARTBEAT_SECONDS,
        "overtime_requires_approval": cs.overtime_requires_approval,
        # The workplace itself is not personal data; employees need it to see their distance.
        "workplace": {
            "configured": cs.geofence_configured,
            "latitude": float(cs.workplace_latitude) if cs.geofence_configured else None,
            "longitude": float(cs.workplace_longitude) if cs.geofence_configured else None,
            "radius_m": cs.geofence_radius_m,
            "max_accuracy_m": cs.geofence_max_accuracy_m,
        },
        "wfh_today": WorkFromHomeRequestSerializer(state["wfh"]).data if state["wfh"] else None,
        "open_overtime_request": (
            OvertimeSessionSerializer(state["open_overtime"]).data if state["open_overtime"] else None
        ),
        "record": AttendanceRecordSerializer(record).data if record else None,
        "breaks": BreakSessionSerializer(state["breaks"], many=True).data,
        "active_break": BreakSessionSerializer(state["active_break"]).data if state["active_break"] else None,
        "overtime": OvertimeSessionSerializer(state["overtime"], many=True).data,
        "active_overtime": (
            OvertimeSessionSerializer(state["active_overtime"]).data if state["active_overtime"] else None
        ),
        "blocking_tasks": task_rules.blocking_tasks(request.user).count(),
        "checkout_exempt": task_rules.is_exempt(request.user),
        # Meetings: working time is paused while `active_pause` is set (server-recorded).
        "active_meeting": MeetingSerializer(state["active_meeting"]).data if state["active_meeting"] else None,
        "active_pause": MeetingPauseSerializer(pause).data if pause else None,
        "meeting_pauses": MeetingPauseSerializer(state["meeting_pauses"], many=True).data,
        # Non-working time: automatic inactivity check-out until an approved re-check-in.
        "non_working": NonWorkingPeriodSerializer(state["non_working"], many=True).data,
        "open_non_working": (
            NonWorkingPeriodSerializer(state["open_non_working"]).data if state["open_non_working"] else None
        ),
        "resume_request": (
            ResumeWorkRequestSerializer(state["resume_request"]).data if state["resume_request"] else None
        ),
        "required_work_seconds": (
            int(cs.full_day_min_hours * 3600) if cs.full_day_min_hours is not None else None
        ),
    }


def settle_rules(request):
    """Apply due time-based rules (inactivity, break allowance) before a manual action, so a
    direct API call cannot act on a session the rules have already closed."""
    meetings.settle_meetings()
    employee = Employee.objects.filter(user=request.user).first()
    if employee is not None:
        activity.reconcile_employee(employee, request=request)
        resume.expire_stale(employee)


def perform_event(request, event_type):
    """Online break/overtime action. With a client_event_id the call is idempotent: a retry of
    an already-applied event returns the current state instead of failing or applying twice."""
    ser = EventIdSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    settle_rules(request)
    client_event_id = ser.validated_data.get("client_event_id")
    duplicate = False
    if client_event_id is None:
        sessions.HANDLERS[event_type](request)
    else:
        sessions.assert_can_self_record(request.user)  # permission problems stay 403
        event, duplicate = sessions.record_event(request, client_event_id, event_type, SyncEvent.Channel.ONLINE)
        if event.status == SyncEvent.Status.CONFLICT:
            raise Conflict(event.error)
        if event.status == SyncEvent.Status.REJECTED:
            raise serializers.ValidationError({"non_field_errors": [event.error]})
    return Response({"duplicate": duplicate, "state": today_payload(request)})


class AttendanceFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = AttendanceRecord
        fields = ["employee", "status", "is_late", "date"]


class AttendanceViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "today": ("attendance.self",),
        "check_in": ("attendance.self",),
        "check_out": ("attendance.self",),
        "heartbeat": ("attendance.self",),
        "sync": ("attendance.self",),
        "daily": ("attendance.view_team", "attendance.view_all"),
        "create": ("attendance.manage",),
        "update": ("attendance.manage",),
        "partial_update": ("attendance.manage",),
        "destroy": ("attendance.manage",),
    }
    filterset_class = AttendanceFilter
    ordering_fields = ["date", "check_in"]
    throttle_scope = None  # only the heartbeat action is rate-limited (scope "heartbeat")

    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = AttendanceRecord.objects.select_related("employee__user")
        return scope_queryset(qs, self.request.user, "attendance")

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return AttendanceAdminSerializer
        return AttendanceRecordSerializer

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        record = services.admin_save(request, dict(ser.validated_data))
        return Response(AttendanceRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        record = self.get_object()
        ser = self.get_serializer(record, data=request.data, partial=kwargs.pop("partial", False))
        ser.is_valid(raise_exception=True)
        record = services.admin_save(request, dict(ser.validated_data), record=record)
        return Response(AttendanceRecordSerializer(record).data)

    def perform_destroy(self, record):
        services.assert_can_manage_record_for(self.request.user, record.employee)
        audit.record(
            self.request,
            "ATTENDANCE_DELETED",
            obj=record,
            changes=audit.snapshot(record, services.AUDIT_FIELDS),
        )
        record.delete()

    @action(detail=False, methods=["get"])
    def today(self, request):
        return Response(today_payload(request))

    @action(detail=False, methods=["post"], url_path="check-in")
    def check_in(self, request):
        ser = CheckInSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        settle_rules(request)
        record = services.check_in(request, **ser.validated_data)
        return Response(AttendanceRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request):
        ser = CheckOutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        settle_rules(request)
        record = services.check_out(request, latitude=data.get("latitude"), longitude=data.get("longitude"))
        return Response(AttendanceRecordSerializer(record).data)

    @action(detail=False, methods=["post"], throttle_classes=[ScopedRateThrottle], throttle_scope="heartbeat")
    def heartbeat(self, request):
        """Privacy-safe activity report: seconds since the last interaction (+ location in
        office mode). Applies the inactivity / geofence rules and returns the fresh state."""
        ser = HeartbeatSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        changed = activity.heartbeat(request, **ser.validated_data)
        return Response({"changed": changed, "state": today_payload(request, reconcile=False)})

    @action(detail=False, methods=["post"])
    def sync(self, request):
        """Synchronise work-session events queued while offline. Idempotent per event id."""
        sessions.assert_can_self_record(request.user)
        ser = SyncRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        results = sessions.sync_batch(request, ser.validated_data["events"])
        return Response(
            {
                "results": [
                    {
                        "id": str(r["event"].client_event_id),
                        "type": r["event"].event_type,
                        "status": r["event"].status,
                        "duplicate": r["duplicate"],
                        "error": r["event"].error,
                    }
                    for r in results
                ],
                "state": today_payload(request),
            }
        )

    @action(detail=False, methods=["get"])
    def daily(self, request):
        """Status of every in-scope employee for ?date= (default: today)."""
        cs = CompanySettings.get_solo()
        raw = request.query_params.get("date")
        try:
            day = datetime.date.fromisoformat(raw) if raw else services.company_today(cs)
        except ValueError:
            raise serializers.ValidationError({"date": ["Use YYYY-MM-DD."]}) from None
        employees = scope_queryset(
            Employee.objects.select_related("user").exclude(employment_status=Employee.Status.EXITED),
            request.user,
            "attendance",
            employee_path="",
        )
        department = request.query_params.get("department")
        if department and department.isdigit():
            employees = employees.filter(department_id=int(department))
        rows = services.daily_status(list(employees), day, cs)
        return Response(
            {
                "date": day,
                "results": [
                    {
                        "employee": employee_ref(r["employee"]),
                        "status": r["status"],
                        "record": AttendanceRecordSerializer(r["record"]).data if r["record"] else None,
                    }
                    for r in rows
                ],
            }
        )


class BreakFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="attendance__date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="attendance__date", lookup_expr="lte")

    class Meta:
        model = BreakSession
        fields = ["employee", "status", "source"]


class BreakViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Break history (own / team / all by attendance scope) plus start/end for the caller."""

    serializer_class = BreakSessionSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "start": ("attendance.self",), "end": ("attendance.self",)}
    filterset_class = BreakFilter
    ordering_fields = ["started_at"]

    def get_queryset(self):
        qs = BreakSession.objects.select_related("employee__user", "attendance")
        return scope_queryset(qs, self.request.user, "attendance")

    @action(detail=False, methods=["post"])
    def start(self, request):
        return perform_event(request, SyncEvent.Type.BREAK_START)

    @action(detail=False, methods=["post"])
    def end(self, request):
        return perform_event(request, SyncEvent.Type.BREAK_END)


class OvertimeFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = OvertimeSession
        fields = ["employee", "status", "source"]


class OvertimeViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Overtime records (kept separate from normal attendance) plus start/end for the caller."""

    serializer_class = OvertimeSessionSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "start": ("attendance.self",),
        "end": ("attendance.self",),
        "request_overtime": ("attendance.self",),
        "cancel": ("attendance.self",),
        "approve": ("overtime.approve",),
        "reject": ("overtime.approve",),
    }
    filterset_class = OvertimeFilter
    ordering_fields = ["started_at", "date", "duration_seconds"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = OvertimeSession.objects.select_related("employee__user", "decided_by").prefetch_related("tasks")
        return scope_queryset(qs, self.request.user, "attendance")

    @action(detail=False, methods=["post"], url_path="request")
    def request_overtime(self, request):
        """The overtime declaration: tasks or another reason, a description, a confirmation."""
        ser = OvertimeRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        sessions.request_overtime(
            request,
            task_ids=data["task_ids"],
            work_description=data["work_description"],
            other_reason=data["other_reason"],
        )
        return Response({"state": today_payload(request)}, status=status.HTTP_201_CREATED)

    def _decide(self, request, approve):
        ser = DecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        session = sessions.decide_overtime(request, self.get_object(), approve, ser.validated_data["note"])
        return Response(OvertimeSessionSerializer(session).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, False)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        sessions.cancel_overtime(request, self.get_object())
        return Response({"state": today_payload(request)})

    @action(detail=False, methods=["post"])
    def start(self, request):
        return perform_event(request, SyncEvent.Type.OVERTIME_START)

    @action(detail=False, methods=["post"])
    def end(self, request):
        return perform_event(request, SyncEvent.Type.OVERTIME_END)


class SyncEventFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="received_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="received_at", lookup_expr="date__lte")

    class Meta:
        model = SyncEvent
        fields = ["employee", "status", "channel", "event_type"]


class SyncEventViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Synchronisation log: own events, or team / all for monitoring (attendance scope)."""

    serializer_class = SyncEventSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": ()}
    filterset_class = SyncEventFilter
    ordering_fields = ["received_at"]

    def get_queryset(self):
        qs = SyncEvent.objects.select_related("employee__user")
        return scope_queryset(qs, self.request.user, "attendance")


class WorkFromHomeFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = WorkFromHomeRequest
        fields = ["employee", "status", "date"]


class WorkFromHomeViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Work-from-home requests: employees create/cancel their own; HR / Super Admin decide.
    Visibility follows the attendance scope (own / team / all)."""

    serializer_class = WorkFromHomeRequestSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "create": ("attendance.self",),
        "cancel": ("attendance.self",),
        "approve": ("wfh.approve",),
        "reject": ("wfh.approve",),
    }
    filterset_class = WorkFromHomeFilter
    ordering_fields = ["date", "created_at"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = WorkFromHomeRequest.objects.select_related("employee__user", "decided_by")
        return scope_queryset(qs, self.request.user, "attendance")

    def create(self, request):
        ser = WorkFromHomeRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        obj = wfh.create_request(request, date=data["date"], reason=data["reason"], remarks=data.get("remarks", ""))
        return Response(WorkFromHomeRequestSerializer(obj).data, status=status.HTTP_201_CREATED)

    def _decide(self, request, approve):
        ser = DecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        obj = wfh.decide(request, self.get_object(), approve, ser.validated_data["note"])
        return Response(WorkFromHomeRequestSerializer(obj).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, False)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        obj = wfh.cancel(request, self.get_object())
        return Response(WorkFromHomeRequestSerializer(obj).data)


class MeetingFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    history = django_filters.BooleanFilter(method="filter_history", label="Completed or cancelled only")

    def filter_history(self, qs, name, value):
        finished = [Meeting.Status.COMPLETED, Meeting.Status.CANCELLED]
        return qs.filter(status__in=finished) if value else qs.exclude(status__in=finished)

    class Meta:
        model = Meeting
        fields = ["status", "kind"]


class MeetingViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Company meetings. HR / Super Admin (meetings.manage) create, start, end and cancel them and
    see every meeting; everyone else sees overall meetings and the ones they are invited to."""

    serializer_class = MeetingSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "create": ("meetings.manage",),
        "partial_update": ("meetings.manage",),
        "start": ("meetings.manage",),
        "end": ("meetings.manage",),
        "cancel": ("meetings.manage",),
    }
    filterset_class = MeetingFilter
    ordering_fields = ["created_at", "started_at", "scheduled_start"]
    search_fields = ["title"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = Meeting.objects.select_related("created_by", "started_by", "ended_by").prefetch_related(
            "participants__user"
        )
        if self.request.user.has_permission("meetings.manage"):
            return qs
        employee = Employee.objects.filter(user=self.request.user).first()
        if employee is None:
            return qs.filter(kind=Meeting.Kind.OVERALL)
        return qs.filter(Q(kind=Meeting.Kind.OVERALL) | Q(participants=employee)).distinct()

    def _respond(self, meeting, code=status.HTTP_200_OK):
        return Response(MeetingSerializer(self.get_queryset().get(pk=meeting.pk)).data, status=code)

    def create(self, request):
        ser = MeetingWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        meeting = meetings.create_meeting(
            request,
            title=data["title"],
            agenda=data["agenda"],
            kind=data["kind"],
            participants=data["participant_ids"],
            scheduled_start=data["scheduled_start"],
            scheduled_end=data["scheduled_end"],
        )
        return self._respond(meeting, status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        meeting = self.get_object()
        ser = MeetingWriteSerializer(data={"kind": meeting.kind, **request.data}, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        fields = [f for f in ("title", "agenda", "scheduled_start", "scheduled_end") if f in request.data]
        meeting = meetings.update_meeting(
            request,
            meeting,
            title=data.get("title"),
            agenda=data.get("agenda"),
            participants=data["participant_ids"] if "participant_ids" in request.data else None,
            scheduled_start=data.get("scheduled_start"),
            scheduled_end=data.get("scheduled_end"),
            fields=fields,
        )
        return self._respond(meeting)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self._respond(meetings.start_meeting(request, self.get_object()))

    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        return self._respond(meetings.end_meeting(request, self.get_object()))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._respond(meetings.cancel_meeting(request, self.get_object()))


class ResumeWorkFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="date", lookup_expr="lte")

    class Meta:
        model = ResumeWorkRequest
        fields = ["employee", "status", "date"]


class ResumeWorkRequestViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Resume Work requests: employees create / cancel their own; HR / Super Admin decide.
    Visibility follows the attendance scope (own / team / all)."""

    serializer_class = ResumeWorkRequestSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "create": ("attendance.self",),
        "cancel": ("attendance.self",),
        "approve": ("resume.approve",),
        "reject": ("resume.approve",),
    }
    filterset_class = ResumeWorkFilter
    ordering_fields = ["date", "created_at"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = ResumeWorkRequest.objects.select_related("employee__user", "decided_by")
        if self.request.user.has_permission("resume.approve"):
            return qs
        return scope_queryset(qs, self.request.user, "attendance")

    def create(self, request):
        ser = ResumeWorkRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        settle_rules(request)
        resume.create_request(request, reason=ser.validated_data["reason"])
        return Response({"state": today_payload(request)}, status=status.HTTP_201_CREATED)

    def _decide(self, request, approve):
        ser = DecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        obj = resume.decide(request, self.get_object(), approve, ser.validated_data["note"])
        return Response(ResumeWorkRequestSerializer(obj).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, False)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        resume.cancel(request, self.get_object())
        return Response({"state": today_payload(request)})
