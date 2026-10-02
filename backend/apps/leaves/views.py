import django_filters
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import HasPermission, scope_queryset
from apps.core.views import AuditedModelViewSet
from apps.employees.models import Employee
from apps.organization.models import CompanySettings

from . import services
from .models import LeaveBalance, LeaveRequest, LeaveType
from .serializers import (
    AllocateSerializer,
    DecisionSerializer,
    LeaveApplySerializer,
    LeaveBalanceSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)


class LeaveTypeViewSet(AuditedModelViewSet):
    serializer_class = LeaveTypeSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "retrieve": (), "*": ("leave.manage_types",)}
    filterset_fields = ["is_active", "is_paid"]
    pagination_class = None
    audit_name = "LEAVE_TYPE"
    queryset = LeaveType.objects.all()


class LeaveBalanceViewSet(AuditedModelViewSet):
    serializer_class = LeaveBalanceSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "retrieve": (), "mine": (), "*": ("leave.manage_balances",)}
    filterset_fields = ["employee", "leave_type", "year"]
    audit_name = "LEAVE_BALANCE"

    def get_queryset(self):
        qs = LeaveBalance.objects.select_related("employee__user", "leave_type")
        return scope_queryset(qs, self.request.user, "leave")

    def perform_create(self, serializer):
        services.assert_can_manage_balance_for(self.request.user, serializer.validated_data["employee"])
        super().perform_create(serializer)

    def perform_update(self, serializer):
        services.assert_can_manage_balance_for(self.request.user, serializer.instance.employee)
        if "employee" in serializer.validated_data:
            services.assert_can_manage_balance_for(self.request.user, serializer.validated_data["employee"])
        super().perform_update(serializer)

    def perform_destroy(self, balance):
        services.assert_can_manage_balance_for(self.request.user, balance.employee)
        super().perform_destroy(balance)

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """Own balances for every active leave type in ?year= (default: current leave year)."""
        employee = Employee.objects.filter(user=request.user).first()
        if employee is None:
            return Response({"year": None, "results": []})
        cs = CompanySettings.get_solo()
        year = request.query_params.get("year")
        year = int(year) if year and year.isdigit() else cs.leave_year_for(cs.today())
        results = []
        for leave_type in services.active_types():
            summary = services.balance_summary(employee, leave_type, year)
            results.append(
                {
                    "leave_type": leave_type.id,
                    "leave_type_name": leave_type.name,
                    "is_paid": leave_type.is_paid,
                    "allow_half_day": leave_type.allow_half_day,
                    "tracks_balance": leave_type.tracks_balance,
                    **(summary or {}),
                }
            )
        return Response({"year": year, "results": results})

    @action(detail=False, methods=["post"])
    def allocate(self, request):
        ser = AllocateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        employees = data.get("employees") or Employee.objects.exclude(employment_status=Employee.Status.EXITED)
        result = services.allocate(
            request, data["leave_type"], data["year"], data["allocated"], employees, data["overwrite"]
        )
        return Response(result)


class LeaveRequestFilter(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name="end_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="start_date", lookup_expr="lte")

    class Meta:
        model = LeaveRequest
        fields = ["status", "employee", "leave_type", "leave_year"]


class LeaveRequestViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    serializer_class = LeaveRequestSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "create": ("leave.apply",),
        "cancel": ("leave.apply",),
        "approve": ("leave.approve_team", "leave.approve_all"),
        "reject": ("leave.approve_team", "leave.approve_all"),
        "pending_approvals": ("leave.approve_team", "leave.approve_all"),
    }
    filterset_class = LeaveRequestFilter
    ordering_fields = ["start_date", "created_at"]

    def get_queryset(self):
        qs = LeaveRequest.objects.select_related(
            "employee__user", "employee__manager", "leave_type", "decided_by"
        )
        return scope_queryset(qs, self.request.user, "leave")

    def create(self, request, *args, **kwargs):
        ser = LeaveApplySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        leave = services.submit(request, ser.validated_data)
        return Response(self.get_serializer(leave).data, status=status.HTTP_201_CREATED)

    def _decide(self, request, approve):
        leave = self.get_object()
        ser = DecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        leave = services.decide(request, leave, approve, ser.validated_data.get("note", ""))
        return Response(self.get_serializer(leave).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._decide(request, False)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        leave = services.cancel(request, self.get_object())
        return Response(self.get_serializer(leave).data)

    @action(detail=False, methods=["get"], url_path="pending-approvals")
    def pending_approvals(self, request):
        qs = self.get_queryset().filter(status=LeaveRequest.Status.PENDING).exclude(employee__user=request.user)
        if not request.user.has_permission("leave.approve_all"):
            qs = qs.filter(employee__manager__user=request.user)
        page = self.paginate_queryset(qs.order_by("start_date"))
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

