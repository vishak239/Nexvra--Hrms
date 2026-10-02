from django.utils import timezone

from .models import Notification

# Where the web app shows each kind of entity (used for the notification's link).
ENTITY_LINKS = {
    "leaves.LeaveRequest": "/leave",
    "payroll.Payslip": "/payslips/{id}",
    "documents.EmployeeDocument": "/documents",
    "tasks.Task": "/tasks?task={id}",
    "messaging.Conversation": "/messages?c={id}",
    "attendance.OvertimeSession": "/attendance",
    "attendance.AttendanceRecord": "/attendance",
}


def link_for(notification):
    template = ENTITY_LINKS.get(notification.entity_type)
    if not template:
        return None
    return template.format(id=notification.entity_id)


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


def notify_collapsed(recipient, type, title, message, obj):
    """Like `notify` for one recipient, but refreshes an existing *unread* notification of the
    same type for the same object instead of adding another row (e.g. a busy conversation
    produces one unread "new messages" entry, not one per message)."""
    if recipient is None or not recipient.is_active:
        return None
    existing = (
        Notification.objects.filter(
            recipient=recipient,
            type=type,
            entity_type=obj._meta.label,
            entity_id=str(obj.pk),
            is_read=False,
        )
        .order_by("-id")
        .first()
    )
    if existing is None:
        return notify([recipient], type, title, message, obj=obj)[0]
    existing.title = title
    existing.message = message
    existing.created_at = timezone.now()
    existing.save(update_fields=["title", "message", "created_at"])
    return existing
