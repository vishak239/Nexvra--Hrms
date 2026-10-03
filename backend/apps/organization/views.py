from django.db.models import Count, Q
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.core.permissions import HasPermission
from apps.core.views import AuditedModelViewSet

from .models import Company, CompanySettings, Department, Designation, Holiday, Policy
from .serializers import (
    CompanySerializer,
    CompanySettingsSerializer,
    DepartmentSerializer,
    DesignationSerializer,
    HolidaySerializer,
    PolicySerializer,
)


class SingletonView(APIView):
    """GET for any authenticated user; PATCH needs `manage_permission`."""

    permission_classes = [HasPermission]
    model = None
    serializer_class = None
    audit_action = ""

    @property
    def required_permissions(self):
        return {"get": (), "patch": (self.manage_permission,)}

    def get(self, request):
        return Response(self.serializer_class(self.model.get_solo()).data)

    def patch(self, request):
        obj = self.model.get_solo()
        ser = self.serializer_class(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        fields = list(ser.validated_data)
        before = audit.snapshot(obj, fields)
        obj = ser.save()
        audit.record(request, self.audit_action, obj=obj, changes=audit.diff(before, audit.snapshot(obj, fields)))
        return Response(self.serializer_class(obj).data)


class CompanyView(SingletonView):
    model = Company
    serializer_class = CompanySerializer
    manage_permission = "company.manage"
    audit_action = "COMPANY_UPDATED"


class SettingsView(SingletonView):
    model = CompanySettings
    serializer_class = CompanySettingsSerializer
    manage_permission = "settings.manage"
    audit_action = "SETTINGS_UPDATED"


class DepartmentViewSet(AuditedModelViewSet):
    serializer_class = DepartmentSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "retrieve": (), "*": ("departments.manage",)}
    search_fields = ["name", "code"]
    filterset_fields = ["is_active"]
    audit_name = "DEPARTMENT"

    def get_queryset(self):
        qs = Department.objects.select_related("head__user").annotate(employee_count=Count("employees"))
        return qs.order_by("name")


class DesignationViewSet(AuditedModelViewSet):
    serializer_class = DesignationSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "retrieve": (), "*": ("designations.manage",)}
    search_fields = ["name"]
    filterset_fields = ["is_active"]
    audit_name = "DESIGNATION"

    def get_queryset(self):
        return Designation.objects.annotate(employee_count=Count("employees")).order_by("name")


class HolidayViewSet(AuditedModelViewSet):
    serializer_class = HolidaySerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "retrieve": (), "*": ("holidays.manage",)}
    pagination_class = None
    audit_name = "HOLIDAY"

    def get_queryset(self):
        qs = Holiday.objects.all()
        year = self.request.query_params.get("year")
        if year and year.isdigit():
            qs = qs.filter(date__year=int(year))
        return qs


class PolicyViewSet(AuditedModelViewSet):
    """Company policies. Everyone signed in reads published policies; drafts and changes
    need `policies.manage` (a draft is a 404 for everyone else)."""

    serializer_class = PolicySerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": (), "retrieve": (), "*": ("policies.manage",)}
    audit_name = "POLICY"

    def get_queryset(self):
        qs = Policy.objects.select_related("updated_by")
        params = self.request.query_params
        if not self.request.user.has_permission("policies.manage"):
            qs = qs.filter(is_published=True)
        elif params.get("status") in ("published", "draft"):
            qs = qs.filter(is_published=params["status"] == "published")
        if params.get("category"):
            qs = qs.filter(category=params["category"])
        if q := params.get("q", "").strip():
            qs = qs.filter(Q(title__icontains=q) | Q(body__icontains=q))
        return qs

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.record(
            self.request,
            "POLICY_CREATED",
            obj=obj,
            changes={k: v for k, v in serializer.validated_data.items() if k != "body"},
        )

    def perform_update(self, serializer):
        fields = [f for f in serializer.validated_data if f != "body"]
        before = audit.snapshot(serializer.instance, fields)
        new_body = serializer.validated_data.get("body")
        body_changed = new_body is not None and new_body != serializer.instance.body
        obj = serializer.save(updated_by=self.request.user)
        # The policy text itself is not copied into the audit log; only that it changed.
        audit.record(
            self.request,
            "POLICY_UPDATED",
            obj=obj,
            changes=audit.diff(before, audit.snapshot(obj, fields)),
            metadata={"body_changed": body_changed},
        )
