from django.db.models import Count, Sum
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit import services as audit
from apps.core.permissions import SCOPE_ALL, HasPermission, get_scope
from apps.core.views import AuditedModelViewSet

from . import services
from .models import PayComponent, PayrollRun, Payslip, SalaryStructure
from .serializers import (
    PayComponentSerializer,
    PayrollRunSerializer,
    PayslipItemSerializer,
    PayslipSerializer,
    SalaryStructureSerializer,
)


class PayComponentViewSet(AuditedModelViewSet):
    serializer_class = PayComponentSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": ("payroll.view_all", "payroll.manage"),
        "retrieve": ("payroll.view_all", "payroll.manage"),
        "*": ("payroll.manage",),
    }
    filterset_fields = ["kind", "is_active"]
    pagination_class = None
    audit_name = "PAY_COMPONENT"
    queryset = PayComponent.objects.all()


class SalaryStructureViewSet(viewsets.ModelViewSet):
    serializer_class = SalaryStructureSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": ("payroll.view_all",),
        "retrieve": ("payroll.view_all",),
        "*": ("payroll.manage",),
    }
    filterset_fields = ["employee"]

    def get_queryset(self):
        return SalaryStructure.objects.select_related("employee__user").prefetch_related("items__component")

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        items = data.pop("items", [])
        structure = services.save_structure(request, data, items)
        return Response(self.get_serializer(self.get_queryset().get(pk=structure.pk)).data, status=201)

    def update(self, request, *args, **kwargs):
        structure = self.get_object()
        ser = self.get_serializer(structure, data=request.data, partial=kwargs.pop("partial", False))
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        items = data.pop("items", None)
        if "employee" in data and data["employee"] != structure.employee:
            data.pop("employee")
        services.save_structure(request, data, items, structure=structure)
        return Response(self.get_serializer(self.get_queryset().get(pk=structure.pk)).data)

    def perform_destroy(self, structure):
        services.assert_not_self(self.request.user, structure.employee)
        audit.record(self.request, "SALARY_STRUCTURE_DELETED", obj=structure)
        structure.delete()


class PayrollRunViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PayrollRunSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": ("payroll.view_all",), "retrieve": ("payroll.view_all",), "*": ("payroll.manage",)}
    filterset_fields = ["year", "status"]

    def get_queryset(self):
        return PayrollRun.objects.annotate(
            payslip_count=Count("payslips"), total_net=Sum("payslips__net_pay")
        ).order_by("-year", "-month")

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        run = services.create_run(request, ser.validated_data["year"], ser.validated_data["month"])
        return Response(self.get_serializer(self.get_queryset().get(pk=run.pk)).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, run):
        services.assert_draft(run)
        audit.record(self.request, "PAYROLL_RUN_DELETED", obj=run, metadata={"period": f"{run.year}-{run.month:02d}"})
        run.delete()

    @action(detail=True, methods=["post"])
    def generate(self, request, pk=None):
        return Response(services.generate(request, self.get_object()))

    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        run = services.finalize(request, self.get_object())
        return Response(self.get_serializer(self.get_queryset().get(pk=run.pk)).data)


class PayslipViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin,
                     viewsets.GenericViewSet):
    """Employees see only their own payslips from FINALIZED runs; HR sees all."""

    serializer_class = PayslipSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": ("payroll.view_own", "payroll.view_all"),
        "retrieve": ("payroll.view_own", "payroll.view_all"),
        "*": ("payroll.manage",),
    }
    filterset_fields = ["run", "employee", "run__year", "run__month", "run__status"]

    def get_queryset(self):
        qs = Payslip.objects.select_related(
            "run", "employee__user", "employee__department", "employee__designation"
        ).prefetch_related("items")
        if get_scope(self.request.user, "payroll") == SCOPE_ALL:
            return qs
        return qs.filter(employee__user=self.request.user, run__status=PayrollRun.Status.FINALIZED)

    def perform_destroy(self, payslip):
        services.delete_payslip(self.request, payslip)

    @action(detail=True, methods=["post"], url_path="adjustments")
    def add_adjustment(self, request, pk=None):
        payslip = self.get_object()
        ser = PayslipItemSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        services.add_adjustment(request, payslip, **ser.validated_data)
        return Response(self.get_serializer(self.get_queryset().get(pk=payslip.pk)).data, status=201)

    @action(detail=True, methods=["delete"], url_path=r"adjustments/(?P<item_id>\d+)")
    def remove_adjustment(self, request, pk=None, item_id=None):
        payslip = self.get_object()
        services.remove_adjustment(request, payslip, int(item_id))
        return Response(self.get_serializer(self.get_queryset().get(pk=payslip.pk)).data)
