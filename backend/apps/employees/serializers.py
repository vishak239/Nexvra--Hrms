from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.accounts.models import Role, User
from apps.accounts.rbac import EMPLOYEE
from apps.accounts.serializers import UsernameField, assert_username_free
from apps.organization.models import Department, Designation

from .models import Employee

CONFIDENTIAL_FIELDS = (
    "phone",
    "address",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relation",
    "exit_date",
    "role",
    "is_active",
)
SELF_EDITABLE_FIELDS = (
    "phone",
    "address",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relation",
)


def employee_ref(emp):
    if emp is None:
        return None
    return {
        "id": emp.id,
        "employee_code": emp.employee_code,
        "full_name": emp.user.full_name,
        "username": emp.user.username,
    }


def can_see_confidential(viewer, employee):
    return viewer.has_permission("employees.view_all") or employee.user_id == viewer.pk


class EmployeeSerializer(serializers.ModelSerializer):
    """Read serializer. Confidential fields are only included for the employee themselves
    and for viewers holding `employees.view_all` (HR / Super Admin). Managers viewing
    their team get the basic fields only."""

    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name")
    full_name = serializers.CharField(source="user.full_name")
    email = serializers.EmailField(source="user.email")
    username = serializers.CharField(source="user.username", default=None)
    role = serializers.CharField(source="user.role.code")
    is_active = serializers.BooleanField(source="user.is_active")
    department = serializers.SerializerMethodField()
    designation = serializers.SerializerMethodField()
    manager = serializers.SerializerMethodField()
    has_photo = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id",
            "employee_code",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "username",
            "department",
            "designation",
            "manager",
            "employment_type",
            "employment_status",
            "joining_date",
            "has_photo",
            *CONFIDENTIAL_FIELDS,
        ]
        read_only_fields = fields

    def get_department(self, emp):
        return {"id": emp.department_id, "name": emp.department.name} if emp.department_id else None

    def get_designation(self, emp):
        return {"id": emp.designation_id, "name": emp.designation.name} if emp.designation_id else None

    def get_manager(self, emp):
        return employee_ref(emp.manager)

    def get_has_photo(self, emp):
        return bool(emp.photo)

    def to_representation(self, emp):
        data = super().to_representation(emp)
        if not can_see_confidential(self.context["request"].user, emp):
            for field in CONFIDENTIAL_FIELDS:
                data.pop(field, None)
        return data


class EmployeeWriteSerializer(serializers.ModelSerializer):
    """HR create/update. User fields are written through to the linked account."""

    email = serializers.EmailField()
    username = UsernameField()
    first_name = serializers.CharField(max_length=100)
    last_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    role = serializers.SlugRelatedField(slug_field="code", queryset=Role.objects.all(), required=False)
    is_active = serializers.BooleanField(required=False)
    initial_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, trim_whitespace=False
    )
    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(), required=False, allow_null=True
    )
    designation = serializers.PrimaryKeyRelatedField(
        queryset=Designation.objects.all(), required=False, allow_null=True
    )
    manager = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), required=False, allow_null=True)

    USER_FIELDS = ("email", "username", "first_name", "last_name", "role", "is_active")

    class Meta:
        model = Employee
        fields = [
            "email",
            "username",
            "first_name",
            "last_name",
            "role",
            "is_active",
            "initial_password",
            "employee_code",
            "phone",
            "joining_date",
            "exit_date",
            "department",
            "designation",
            "manager",
            "employment_type",
            "employment_status",
            "address",
            "emergency_contact_name",
            "emergency_contact_phone",
            "emergency_contact_relation",
        ]

    def validate_email(self, value):
        value = value.strip().lower()
        qs = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.user_id)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_employee_code(self, value):
        return value.strip()

    def _changed(self, attrs, field):
        return field in attrs and (self.instance is None or attrs[field] != getattr(self.instance, field))

    def validate(self, attrs):
        if "username" in attrs:
            if attrs["username"]:
                assert_username_free(attrs["username"], self.instance.user_id if self.instance else None)
            else:
                attrs.pop("username")  # blank = keep the current one (or generate on create)
        if self.instance is None:
            attrs.setdefault("role", Role.objects.get(code=EMPLOYEE))
            if attrs.get("initial_password"):
                validate_password(
                    attrs["initial_password"], User(email=attrs["email"], first_name=attrs["first_name"])
                )
        elif "initial_password" in attrs:
            raise serializers.ValidationError({"initial_password": ["Only allowed when creating an employee."]})

        for field in ("department", "designation"):
            if self._changed(attrs, field) and attrs[field] is not None and not attrs[field].is_active:
                raise serializers.ValidationError({field: ["This record is inactive."]})

        manager = attrs.get("manager")
        if self._changed(attrs, "manager") and manager is not None:
            if self.instance is not None:
                node, seen = manager, set()
                while node is not None and node.pk not in seen:
                    if node.pk == self.instance.pk:
                        raise serializers.ValidationError({"manager": ["This would create a reporting cycle."]})
                    seen.add(node.pk)
                    node = node.manager
            if manager.employment_status == Employee.Status.EXITED:
                raise serializers.ValidationError({"manager": ["Manager has exited the company."]})

        joining = attrs.get("joining_date", getattr(self.instance, "joining_date", None))
        exit_date = attrs.get("exit_date", getattr(self.instance, "exit_date", None))
        status = attrs.get("employment_status", getattr(self.instance, "employment_status", None))
        if exit_date and joining and exit_date < joining:
            raise serializers.ValidationError({"exit_date": ["Exit date cannot be before joining date."]})
        if status == Employee.Status.EXITED and not exit_date:
            raise serializers.ValidationError({"exit_date": ["Exit date is required when status is Exited."]})
        return attrs


class EmployeeSelfUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = list(SELF_EDITABLE_FIELDS)


class PhotoUploadSerializer(serializers.Serializer):
    photo = serializers.FileField()
