from django.http import Http404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts import services as account_services
from apps.audit import services as audit
from apps.core.files import IMAGE_EXTENSIONS, private_file_response, validate_upload
from apps.core.permissions import HasPermission, scope_queryset

from . import services
from .models import Employee
from .serializers import (
    EmployeeSelfUpdateSerializer,
    EmployeeSerializer,
    EmployeeWriteSerializer,
    PhotoUploadSerializer,
)


class EmployeeViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Employees are never hard-deleted; set employment_status=EXITED instead."""

    permission_classes = [HasPermission]
    required_permissions = {
        "list": (),
        "retrieve": (),
        "me": (),
        "photo": (),
        "create": ("employees.manage",),
        "update": ("employees.manage",),
        "partial_update": ("employees.manage",),
    }
    filterset_fields = ["department", "designation", "employment_status", "employment_type", "manager"]
    search_fields = ["employee_code", "user__first_name", "user__last_name", "user__email"]
    ordering_fields = ["employee_code", "joining_date", "user__first_name"]

    def get_queryset(self):
        qs = Employee.objects.select_related(
            "user__role", "department", "designation", "manager__user"
        )
        return scope_queryset(qs, self.request.user, "employees", employee_path="")

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return EmployeeWriteSerializer
        return EmployeeSerializer

    def _read(self, employee, **kwargs):
        return Response(EmployeeSerializer(employee, context=self.get_serializer_context()).data, **kwargs)

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        employee = services.create_employee(request, ser.validated_data)
        return self._read(employee, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        employee = self.get_object()
        ser = self.get_serializer(employee, data=request.data, partial=kwargs.pop("partial", False))
        ser.is_valid(raise_exception=True)
        employee = services.update_employee(request, employee, ser.validated_data)
        return self._read(employee)

    def _own_employee(self, request):
        employee = (
            Employee.objects.select_related("user__role", "department", "designation", "manager__user")
            .filter(user=request.user)
            .first()
        )
        if employee is None:
            raise Http404
        return employee

    @action(detail=False, methods=["get", "patch"])
    def me(self, request):
        employee = self._own_employee(request)
        if request.method == "PATCH":
            ser = EmployeeSelfUpdateSerializer(employee, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            employee = services.self_update(request, employee, ser.validated_data)
        return self._read(employee)

    @action(detail=True, methods=["get", "post", "delete"], parser_classes=[MultiPartParser, FormParser])
    def photo(self, request, pk=None):
        employee = self.get_object()
        if request.method == "GET":
            if not employee.photo:
                raise Http404
            content_type = "image/png" if employee.photo.name.lower().endswith(".png") else "image/jpeg"
            return private_file_response(employee.photo, f"{employee.employee_code}-photo", content_type, inline=True)

        # Changing a photo: the employee themselves, or HR who outranks them.
        if employee.user_id != request.user.pk:
            if not request.user.has_permission("employees.manage"):
                self.permission_denied(request)
            account_services.assert_can_manage_user(request.user, employee.user)

        if request.method == "DELETE":
            if employee.photo:
                employee.photo.delete(save=False)
                employee.photo = ""
                employee.save(update_fields=["photo", "updated_at"])
                audit.record(request, "EMPLOYEE_PHOTO_REMOVED", obj=employee)
            return Response(status=status.HTTP_204_NO_CONTENT)

        ser = PhotoUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        upload = ser.validated_data["photo"]
        validate_upload(upload, IMAGE_EXTENSIONS)
        if employee.photo:
            employee.photo.delete(save=False)
        employee.photo.save(upload.name, upload, save=False)
        employee.save(update_fields=["photo", "updated_at"])
        audit.record(request, "EMPLOYEE_PHOTO_UPDATED", obj=employee)
        return Response({"has_photo": True})
