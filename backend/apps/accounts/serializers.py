from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from . import usernames
from .models import Permission, Role, User


class UsernameField(serializers.CharField):
    """Optional @handle: normalised to lowercase, validated, and unique (case-insensitive)."""

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_blank", True)
        kwargs.setdefault("max_length", usernames.USERNAME_MAX_LENGTH + 1)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        value = usernames.normalize(super().to_internal_value(data))
        if not value:
            return ""
        try:
            usernames.validate_username(value)
        except Exception as exc:  # django ValidationError -> DRF error
            raise serializers.ValidationError(list(getattr(exc, "messages", [str(exc)]))) from None
        return value


def assert_username_free(value, exclude_user_pk=None):
    qs = User.objects.filter(username=value)
    if exclude_user_pk is not None:
        qs = qs.exclude(pk=exclude_user_pk)
    if value and qs.exists():
        raise serializers.ValidationError({"username": ["This username is already taken."]})


class RoleSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "code", "name", "level"]


class MeSerializer(serializers.ModelSerializer):
    role = RoleSummarySerializer(read_only=True)
    full_name = serializers.CharField(read_only=True)
    permissions = serializers.SerializerMethodField()
    employee = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "permissions",
            "must_change_password",
            "employee",
        ]

    def get_permissions(self, user):
        return sorted(user.permission_codes)

    def get_employee(self, user):
        emp = getattr(user, "employee", None)
        if emp is None:
            return None
        return {
            "id": emp.id,
            "employee_code": emp.employee_code,
            "department": emp.department.name if emp.department else None,
            "designation": emp.designation.name if emp.designation else None,
            "has_photo": bool(emp.photo),
        }


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, write_only=True)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": ["Current password is incorrect."]})
        validate_password(attrs["new_password"], user)
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False)


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "codename", "description"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.SlugRelatedField(
        slug_field="codename", many=True, queryset=Permission.objects.all(), required=False
    )
    user_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Role
        fields = ["id", "code", "name", "level", "is_system", "permissions", "user_count"]
        read_only_fields = ["is_system"]

    def to_representation(self, role):
        data = super().to_representation(role)
        if role.is_super_admin:
            data["permissions"] = sorted(Permission.objects.values_list("codename", flat=True))
        return data

    def validate(self, attrs):
        role = self.instance
        if role is not None and role.is_system:
            for field in ("code", "level"):
                if field in attrs and attrs[field] != getattr(role, field):
                    raise serializers.ValidationError({field: ["System roles cannot change this field."]})
        if role is not None and role.is_super_admin and "permissions" in attrs:
            raise serializers.ValidationError({"permissions": ["Super Admin always holds every permission."]})
        return attrs


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SlugRelatedField(slug_field="code", queryset=Role.objects.all())
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    full_name = serializers.CharField(read_only=True)
    employee_id = serializers.SerializerMethodField()
    username = UsernameField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "is_active",
            "must_change_password",
            "password",
            "employee_id",
            "date_joined",
            "last_login",
        ]
        read_only_fields = ["must_change_password", "date_joined", "last_login"]

    def get_employee_id(self, user):
        emp = getattr(user, "employee", None)
        return emp.id if emp else None

    def validate_email(self, value):
        value = value.strip().lower()
        qs = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        if "username" in attrs:
            if attrs["username"]:
                assert_username_free(attrs["username"], self.instance.pk if self.instance else None)
            else:
                attrs.pop("username")  # blank = keep the current one (or generate on create)
        password = attrs.get("password")
        if password:
            candidate = User(
                email=attrs.get("email", getattr(self.instance, "email", "")),
                username=attrs.get("username") or getattr(self.instance, "username", None),
                first_name=attrs.get("first_name", getattr(self.instance, "first_name", "")),
                last_name=attrs.get("last_name", getattr(self.instance, "last_name", "")),
            )
            validate_password(password, candidate)
        return attrs
