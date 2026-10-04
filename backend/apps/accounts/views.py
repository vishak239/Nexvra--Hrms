from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.db.models import Count, ProtectedError
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.core.permissions import HasPermission

from . import services
from .models import Permission, Role, User
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PermissionSerializer,
    RoleSerializer,
    UserSerializer,
)


def _me(user):
    user = User.objects.select_related("role", "employee__department", "employee__designation").get(pk=user.pk)
    return MeSerializer(user).data


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the csrftoken cookie so the SPA can send X-CSRFToken on the login POST."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie set."})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = LoginSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data["email"].strip().lower()
        user = authenticate(request, username=email, password=data.validated_data["password"])
        if user is None:
            audit.record(request, "LOGIN_FAILED", metadata={"email": email}, actor=None)
            raise serializers.ValidationError({"non_field_errors": ["Invalid email or password."]})
        login(request, user)
        audit.record(request, "LOGIN", obj=user, actor=user)
        return Response(_me(user))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        audit.record(request, "LOGOUT", obj=request.user)
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionView(APIView):
    """Session status for the SPA: always 200, so a logged-out visitor isn't an error."""

    permission_classes = [AllowAny]

    def get(self, request):
        if request.user.is_authenticated:
            return Response({"authenticated": True, "user": _me(request.user)})
        return Response({"authenticated": False, "user": None})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_me(request.user))


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = ChangePasswordSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        user = request.user
        user.set_password(ser.validated_data["new_password"])
        user.save(update_fields=["password", "updated_at"])
        update_session_auth_hash(request, user)
        audit.record(request, "PASSWORD_CHANGED", obj=user)
        return Response({"detail": "Password changed."})


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        ser = PasswordResetRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = services.active_user_by_email(ser.validated_data["email"])
        if user is not None:
            services.send_password_setup_email(user, reset=True)
            audit.record(request, "PASSWORD_RESET_REQUESTED", obj=user, actor=None)
        # Same response whether or not the account exists (no enumeration).
        return Response({"detail": "If an account exists for this email, a reset link has been sent."})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        ser = PasswordResetConfirmSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        invalid = serializers.ValidationError({"token": ["This reset link is invalid or has expired."]})
        try:
            uid = force_str(urlsafe_base64_decode(ser.validated_data["uid"]))
            user = User.objects.get(pk=uid, is_active=True)
        except (ValueError, TypeError, OverflowError, User.DoesNotExist):
            raise invalid from None
        if not default_token_generator.check_token(user, ser.validated_data["token"]):
            raise invalid
        validate_password(ser.validated_data["new_password"], user)
        user.set_password(ser.validated_data["new_password"])
        user.save(update_fields=["password", "updated_at"])
        audit.record(request, "PASSWORD_RESET", obj=user, actor=user)
        return Response({"detail": "Password has been reset. You can now log in."})


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [HasPermission]
    required_permissions = {"*": ("roles.view",)}
    pagination_class = None


class RoleViewSet(viewsets.ModelViewSet):
    serializer_class = RoleSerializer
    permission_classes = [HasPermission]
    required_permissions = {
        "list": ("roles.view", "users.manage", "employees.manage"),
        "retrieve": ("roles.view",),
        "*": ("roles.manage",),
    }
    pagination_class = None

    def get_queryset(self):
        return Role.objects.annotate(user_count=Count("users")).prefetch_related("permissions")

    def _audit_permissions(self, role, before):
        after = set(role.permissions.values_list("codename", flat=True))
        if before != after:
            audit.record(
                self.request,
                "ROLE_PERMISSIONS_CHANGED",
                obj=role,
                changes={"added": sorted(after - before), "removed": sorted(before - after)},
            )

    def perform_create(self, serializer):
        level = serializer.validated_data["level"]
        if level >= self.request.user.role.level:
            raise PermissionDenied("Custom roles must rank below your own role.")
        role = serializer.save(is_system=False)
        audit.record(self.request, "ROLE_CREATED", obj=role, metadata={"code": role.code})

    def perform_update(self, serializer):
        role = serializer.instance
        before = set(role.permissions.values_list("codename", flat=True))
        role = serializer.save()
        self._audit_permissions(role, before)

    def perform_destroy(self, role):
        if role.is_system:
            raise PermissionDenied("System roles cannot be deleted.")
        try:
            role.delete()
        except ProtectedError:
            raise Conflict("This role is assigned to users.") from None
        audit.record(self.request, "ROLE_DELETED", metadata={"code": role.code})


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                  mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """System user accounts (Super Admin). Users are deactivated, never deleted."""

    serializer_class = UserSerializer
    permission_classes = [HasPermission]
    required_permissions = {"list": ("users.view",), "retrieve": ("users.view",), "*": ("users.manage",)}
    search_fields = ["email", "username", "first_name", "last_name"]
    filterset_fields = ["is_active", "role__code"]
    ordering_fields = ["email", "first_name", "date_joined"]

    def get_queryset(self):
        return User.objects.select_related("role", "employee")

    @transaction.atomic
    def perform_create(self, serializer):
        services.assert_can_assign_role(self.request.user, serializer.validated_data["role"])
        password = serializer.validated_data.pop("password", "")
        user = User.objects.create_user(password=password or None, **serializer.validated_data)
        if not password:
            services.send_password_setup_email(user, reset=False)
        serializer.instance = user
        audit.record(self.request, "USER_CREATED", obj=user, metadata={"role": user.role.code})

    @transaction.atomic
    def perform_update(self, serializer):
        user = serializer.instance
        actor = self.request.user
        data = serializer.validated_data
        services.assert_can_edit_user(actor, user, data.get("role"), data.get("is_active"))
        fields = ["email", "username", "first_name", "last_name", "role", "is_active"]
        before = audit.snapshot(user, fields)
        password = data.pop("password", "")
        user = serializer.save()
        if password:
            user.set_password(password)
            user.save(update_fields=["password", "updated_at"])
        changes = audit.diff(before, audit.snapshot(user, fields))
        if password:
            changes["password"] = "set"  # nosec B105 - audit marker, not a password
        audit.record(self.request, "USER_UPDATED", obj=user, changes=changes)
