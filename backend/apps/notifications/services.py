import datetime

from django.conf import settings
from django.utils import timezone

from apps.core.mail import send_email

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
    "attendance.WorkFromHomeRequest": "/attendance?tab=wfh",
    "attendance.Meeting": "/meetings",
    "attendance.ResumeWorkRequest": "/attendance?tab=resume",
}


def link_for(notification):
    template = ENTITY_LINKS.get(notification.entity_type)
    if not template:
        return None
    return template.format(id=notification.entity_id)


# The same event raised twice within this window (a retried request, a double click) produces a
# single notification.
DUPLICATE_WINDOW = datetime.timedelta(minutes=2)


def notify(recipients, type, title, message="", obj=None, email=False):
    """Create one in-app notification per distinct, active recipient. With `email=True` the
    same text is also emailed (used for important HR decisions, not for routine events).
    An identical unread notification created moments ago is not repeated."""
    entity_type = obj._meta.label if obj is not None else ""
    entity_id = str(obj.pk) if obj is not None else ""
    candidates = {u.pk: u for u in recipients if u is not None and u.is_active}
    duplicates = set(
        Notification.objects.filter(
            recipient_id__in=list(candidates), type=type, title=title, entity_type=entity_type,
            entity_id=entity_id, is_read=False, created_at__gte=timezone.now() - DUPLICATE_WINDOW,
        ).values_list("recipient_id", flat=True)
    )
    seen = set()
    rows = []
    for user in recipients:
        if user is None or user.pk in seen or not user.is_active or user.pk in duplicates:
            continue
        seen.add(user.pk)
        rows.append(
            Notification(
                recipient=user,
                type=type,
                title=title,
                message=message,
                entity_type=entity_type,
                entity_id=entity_id,
            )
        )
    Notification.objects.bulk_create(rows)
    if email and rows:
        link = f"{settings.FRONTEND_URL.rstrip('/')}{link_for(rows[0]) or '/notifications'}"
        for row in rows:  # one email each, so recipients never see each other's addresses
            send_email(
                f"Nexvra HRMS: {title}",
                f"{title}\n\n{message}\n\nOpen Nexvra HRMS: {link}".strip(),
                [row.recipient.email],
                purpose=f"notification:{type}",
            )
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
        rows = notify([recipient], type, title, message, obj=obj)
        return rows[0] if rows else None
    existing.title = title
    existing.message = message
    existing.created_at = timezone.now()
    existing.save(update_fields=["title", "message", "created_at"])
    return existing
