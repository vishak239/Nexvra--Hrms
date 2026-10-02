"""Backend-enforced RBAC.

Views declare which permission codes each action needs; querysets are then narrowed by
`scope_queryset` so that objects outside the caller's scope are invisible (404).
"""

from django.db.models import Q
from rest_framework.permissions import BasePermission
from rest_framework.viewsets import ViewSetMixin

SCOPE_ALL = "all"
SCOPE_TEAM = "team"
SCOPE_OWN = "own"


class HasPermission(BasePermission):
    """Checks `view.required_permissions`: {action: (codes...)}.

    The user needs ANY one of the listed codes. An empty tuple means "any authenticated
    user". Actions missing from the map fall back to the "*" key; if that is also missing
    the request is denied (secure default).
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        mapping = getattr(view, "required_permissions", None)
        if mapping is None:
            return False
        if isinstance(view, ViewSetMixin):
            action = view.action
        else:
            action = request.method.lower()
            if not hasattr(view, action):
                action = None
        if action is None:
            return True  # method not routed: let DRF answer 405
        if action in mapping:
            codes = mapping[action]
        elif "*" in mapping:
            codes = mapping["*"]
        else:
            return False
        if not codes:
            return True
        return any(user.has_permission(code) for code in codes)


def get_scope(user, area):
    """Return the widest scope the user holds for an area (e.g. "employees", "attendance")."""
    if user.has_permission(f"{area}.view_all"):
        return SCOPE_ALL
    if user.has_permission(f"{area}.view_team"):
        return SCOPE_TEAM
    return SCOPE_OWN


def scope_queryset(queryset, user, area, employee_path="employee"):
    """Filter a queryset to the rows the user may see.

    `employee_path` is the lookup from the model to `employees.Employee`
    ("" when the queryset *is* Employee).
    """
    scope = get_scope(user, area)
    if scope == SCOPE_ALL:
        return queryset
    prefix = f"{employee_path}__" if employee_path else ""
    own = Q(**{f"{prefix}user": user})
    if scope == SCOPE_TEAM:
        return queryset.filter(own | Q(**{f"{prefix}manager__user": user}))
    return queryset.filter(own)
