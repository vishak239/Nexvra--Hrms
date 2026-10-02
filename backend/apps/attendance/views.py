import datetime

import django_filters
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit import services as audit
from apps.core.permissions import HasPermission, scope_queryset
from apps.employees.models import Employee
from apps.employees.serializers import employee_ref
from apps.organization.models import CompanySettings

from . import services
from .models import AttendanceRecord
from .serializers import AttendanceAdminSerializer, AttendanceRecordSerializer


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
        "daily": ("attendance.view_team", "attendance.view_all"),
        "create": ("attendance.manage",),
        "update": ("attendance.manage",),
        "partial_update": ("attendance.manage",),
        "destroy": ("attendance.manage",),
    }
    filterset_class = AttendanceFilter
    ordering_fields = ["date", "check_in"]

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
        cs = CompanySettings.get_solo()
        day = services.company_today(cs)
        record = AttendanceRecord.objects.filter(employee__user=request.user, date=day).first()
        return Response(
            {
                "date": day,
                "self_attendance_enabled": cs.self_attendance_enabled,
                "record": AttendanceRecordSerializer(record).data if record else None,
            }
        )

    @action(detail=False, methods=["post"], url_path="check-in")
    def check_in(self, request):
        record = services.check_in(request)
        return Response(AttendanceRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="check-out")
    def check_out(self, request):
        record = services.check_out(request)
        return Response(AttendanceRecordSerializer(record).data)

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
