"""Task checkout protection - the business rule, kept explicit and configurable in one place.

Before HR, a Manager or an Employee checks out, any *blocking* task must be answered first.
A task is blocking when ALL of the following hold:

* it is assigned to the user's employee record,
* `requires_response` is True (HR decides per task; default True),
* its status is in BLOCKING_STATUSES (completed / cancelled tasks never block),
* the assignee has not responded yet (`responded_at` is empty).

Users whose role code is in EXEMPT_ROLE_CODES (Super Admin) are never blocked.

The rule is enforced in the check-out service, so calling the API directly cannot bypass it.
"""

from rest_framework import status
from rest_framework.exceptions import APIException

from apps.accounts.rbac import SUPER_ADMIN

from .models import Task

BLOCKING_STATUSES = (Task.Status.PENDING, Task.Status.IN_PROGRESS)
EXEMPT_ROLE_CODES = frozenset({SUPER_ADMIN})


class CheckoutBlocked(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "checkout_blocked_by_tasks"
    default_detail = "Respond to your pending HR tasks before checking out."


def is_exempt(user):
    return user.role_id is not None and user.role.code in EXEMPT_ROLE_CODES


def blocking_tasks(user):
    if is_exempt(user):
        return Task.objects.none()
    return Task.objects.filter(
        assigned_to__user=user,
        requires_response=True,
        status__in=BLOCKING_STATUSES,
        responded_at__isnull=True,
    )


def assert_checkout_allowed(user):
    count = blocking_tasks(user).count()
    if count:
        raise CheckoutBlocked(
            f"You have {count} pending HR task{'s' if count != 1 else ''} that need{'' if count != 1 else 's'} "
            "a response before you can check out."
        )
