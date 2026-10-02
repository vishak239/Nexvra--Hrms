from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.functional import cached_property

from apps.core.models import TimeStampedModel

from . import rbac


class Permission(models.Model):
    codename = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["codename"]

    def __str__(self):
        return self.codename


class Role(TimeStampedModel):
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=64, unique=True)
    level = models.PositiveSmallIntegerField(help_text="Higher level outranks lower; used to prevent escalation.")
    is_system = models.BooleanField(default=False)
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")

    class Meta:
        ordering = ["-level", "name"]

    def __str__(self):
        return self.name

    @property
    def is_super_admin(self):
        return self.code == rbac.SUPER_ADMIN


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email, password, **extra):
        if not email:
            raise ValueError("Email is required.")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        if "role" not in extra and "role_id" not in extra:
            extra["role"] = Role.objects.get(code=rbac.EMPLOYEE)
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra["role"] = Role.objects.get(code=rbac.SUPER_ADMIN)
        extra["is_staff"] = True
        extra["is_superuser"] = True
        return self._create(email, password, **extra)

    def get_by_natural_key(self, email):
        return self.get(email__iexact=email)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(max_length=254, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100, blank=True)
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="users")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text="Can log into the Django admin (dev only).")
    must_change_password = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["first_name"]

    class Meta:
        ordering = ["first_name", "last_name"]
        constraints = [models.UniqueConstraint(Lower("email"), name="user_email_ci_unique")]

    def __str__(self):
        return self.email

    def save(self, *args, **kwargs):
        self.email = (self.email or "").strip().lower()
        super().save(*args, **kwargs)

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    @cached_property
    def permission_codes(self):
        if not self.is_active or self.role_id is None:
            return frozenset()
        if self.role.is_super_admin:
            return frozenset(Permission.objects.values_list("codename", flat=True))
        return frozenset(self.role.permissions.values_list("codename", flat=True))

    def has_permission(self, code):
        return code in self.permission_codes

    @property
    def is_super_admin(self):
        return self.role_id is not None and self.role.is_super_admin

    def can_manage_role(self, role):
        """Escalation guard: only roles strictly below the actor's own level."""
        if self.is_super_admin:
            return True
        return role.level < self.role.level
