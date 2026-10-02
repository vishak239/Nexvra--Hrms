from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.exceptions import PermissionDenied

from .models import User


def assert_can_assign_role(actor, role):
    if not actor.can_manage_role(role):
        raise PermissionDenied("You cannot assign a role at or above your own level.")


def assert_can_manage_user(actor, target):
    """Actors may manage only accounts ranked strictly below them (Super Admin excepted),
    and never change their own role or active status."""
    if target.pk == actor.pk:
        raise PermissionDenied("You cannot change your own role or account status.")
    if not actor.can_manage_role(target.role):
        raise PermissionDenied("You cannot manage an account at or above your own level.")


def password_reset_link(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?uid={uid}&token={token}"


def send_password_setup_email(user, *, reset=True):
    link = password_reset_link(user)
    if reset:
        subject = "Reset your Nexvra HRMS password"
        body = f"A password reset was requested for your account.\n\nSet a new password: {link}\n\n" \
               "If you did not request this, you can ignore this email."
    else:
        subject = "Your Nexvra HRMS account"
        body = f"An account has been created for you.\n\nSet your password: {link}"
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=True)


def active_user_by_email(email):
    return User.objects.filter(email__iexact=email.strip(), is_active=True).first()


def assert_can_edit_user(actor, target, new_role=None, new_is_active=None):
    """Shared guard for editing an account (directly or through its employee record).

    - Editing your own non-privileged fields is allowed.
    - Changing your own role or active status is never allowed.
    - Editing anyone else requires outranking them; assigning a role requires outranking it.
    """
    role_change = new_role is not None and new_role != target.role
    status_change = new_is_active is not None and new_is_active != target.is_active
    if target.pk != actor.pk or role_change or status_change:
        assert_can_manage_user(actor, target)
    if role_change:
        assert_can_assign_role(actor, new_role)
