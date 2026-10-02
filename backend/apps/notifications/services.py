from .models import Notification


def notify(recipients, type, title, message="", obj=None):
    """Create one in-app notification per distinct, active recipient."""
    seen = set()
    rows = []
    for user in recipients:
        if user is None or user.pk in seen or not user.is_active:
            continue
        seen.add(user.pk)
        rows.append(
            Notification(
                recipient=user,
                type=type,
                title=title,
                message=message,
                entity_type=obj._meta.label if obj is not None else "",
                entity_id=str(obj.pk) if obj is not None else "",
            )
        )
    Notification.objects.bulk_create(rows)
    return rows
