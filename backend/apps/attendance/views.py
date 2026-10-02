import datetime

import django_filters
from django.utils import timezone
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.core.permissions import HasPermission, scope_queryset
from apps.employees.models import Employee
from apps.employees.serializers import employee_ref
from apps.organization.models import CompanySettings
from apps.tasks import rules as task_rules

from . import services, sessions
from .models import AttendanceRecord, BreakSession, OvertimeSession, SyncEvent
from .serializers import (
    AttendanceAdminSerializer,
    AttendanceRecordSerializer,
    BreakSessionSerializer,
    EventIdSerializer,
    OvertimeSessionSerializer,
    SyncEventSerializer,
    SyncRequestSerializer,
)


def today_payload(request):
    """Server-authoritative work-session state for the current user (used by the UI to
    render timers and to recover a session after the browser was closed)."""
    state = sessions.today_state(request.user)
    record = state["record"]
    return {
        "date": state["date"],
        "server_time": serializers.DateTimeField().to_representation(timezone.now()),
        "self_attendance_enabled": state["cs"].self_attendance_enabled,
        "record": AttendanceRecordSerializer(record).data if record else None,
        "breaks": BreakSessionSerializer(state["breaks"], many=True).data,
        "active_break": BreakSessionSerializer(state["active_break"]).data if state["active_break"] else None,
        "overtime": OvertimeSessionSerializer(state["overtime"], many=True).data,
        "active_overtime": (
            OvertimeSessionSerializer(state["active_overtime"]).data if state["active_overtime"] else None
        ),
        "blocking_tasks": task_rules.blocking_tasks(request.user).count(),
        "checkout_exempt": task_rules.is_exempt(request.user),
    }


def perform_event(request, event_type):
    """Online break/overtime action. With a client_event_id the call is idempotent: a retry of
    an already-applied event returns the current state instead of failing or applying twice."""
    ser = EventIdSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
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
        "sync": ("attendance.self",),
        "daily": ("attendance.view_team", "attendance.view_all"),
        "create": ("attendance.manage",),
        "update": ("attendance.manage",),
        "partial_update": ("attendance.manage",),
        "destroy": ("attendance.manage",),
    }
    filterset_class = AttendanceFilter
    ordering_fields = ["date", "check_in"]

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
        record = services.check_in(request)
        return Response(AttendanceRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request):
        record = services.check_out(request)
        return Response(AttendanceRecordSerializer(record).data)

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
    }
    filterset_class = OvertimeFilter
    ordering_fields = ["started_at", "date", "duration_seconds"]
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        qs = OvertimeSession.objects.select_related("employee__user")
        return scope_queryset(qs, self.request.user, "attendance")

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
