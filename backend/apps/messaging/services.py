from django.db import IntegrityError, transaction
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.core.files import MESSAGE_EXTENSIONS, validate_upload
from apps.notifications.models import Notification
from apps.notifications.services import notify_collapsed

from .models import Conversation, ConversationParticipant, Message, MessageAttachment

MAX_ATTACHMENTS = 5
MAX_BODY_LENGTH = 5000


def can_message(user):
    return user.is_active and user.has_permission("messages.use")


def directory(user, query, limit=20):
    """People the user can start a conversation with, matched by @username, Employee ID or name."""
    q = (query or "").strip()
    if q.startswith("@"):
        q = q[1:]
    qs = (
        User.objects.filter(is_active=True, employee__isnull=False)
        .exclude(pk=user.pk)
        .exclude(employee__employment_status="EXITED")
        .select_related("employee__designation", "employee__department")
    )
    if q:
        terms = Q(username__istartswith=q) | Q(employee__employee_code__iexact=q) | Q(first_name__istartswith=q)
        terms |= Q(last_name__istartswith=q) | Q(employee__employee_code__istartswith=q)
        parts = q.split()
        if len(parts) > 1:
            terms |= Q(first_name__istartswith=parts[0], last_name__istartswith=parts[-1])
        qs = qs.filter(terms)
    return [u for u in qs.order_by("first_name", "last_name")[: limit * 2] if can_message(u)][:limit]


def conversations_for(user):
    my_read = ConversationParticipant.objects.filter(conversation=OuterRef("pk"), user=user).values(
        "last_read_message_id"
    )[:1]
    unread = (
        Message.objects.filter(conversation=OuterRef("pk"), id__gt=OuterRef("my_last_read"))
        .exclude(sender=user)
        .order_by()
        .values("conversation")
        .annotate(n=Count("id"))
        .values("n")
    )
    last_id = Message.objects.filter(conversation=OuterRef("pk")).order_by("-id").values("id")[:1]
    return (
        Conversation.objects.filter(memberships__user=user)
        .annotate(my_last_read=Subquery(my_read))
        .annotate(unread_count=Coalesce(Subquery(unread), 0), last_message_id=Subquery(last_id))
        .prefetch_related("memberships__user__employee")
    )


def unread_total(user):
    # Both conditions are in one filter() call, so they apply to the same membership row.
    return (
        Message.objects.filter(
            conversation__memberships__user=user,
            id__gt=F("conversation__memberships__last_read_message_id"),
        )
        .exclude(sender=user)
        .count()
    )


@transaction.atomic
def get_or_create_conversation(user, other):
    if other.pk == user.pk:
        raise ValidationError({"user_id": ["You cannot start a conversation with yourself."]})
    if not can_message(other):
        raise ValidationError({"user_id": ["This person cannot receive messages."]})
    key = Conversation.key_for(user.pk, other.pk)
    conversation = Conversation.objects.filter(pair_key=key).first()
    if conversation is not None:
        return conversation, False
    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(pair_key=key, created_by=user)
            ConversationParticipant.objects.bulk_create(
                [
                    ConversationParticipant(conversation=conversation, user=user),
                    ConversationParticipant(conversation=conversation, user=other),
                ]
            )
    except IntegrityError:  # created concurrently by the other person
        return Conversation.objects.get(pair_key=key), False
    return conversation, True


def other_participant(conversation, user):
    for membership in conversation.memberships.all():
        if membership.user_id != user.pk:
            return membership.user
    return None


@transaction.atomic
def send(user, conversation, body, files):
    body = (body or "").strip()
    files = list(files or [])
    if not body and not files:
        raise ValidationError({"body": ["Write a message or attach a file."]})
    if len(body) > MAX_BODY_LENGTH:
        raise ValidationError({"body": [f"Messages are limited to {MAX_BODY_LENGTH} characters."]})
    if len(files) > MAX_ATTACHMENTS:
        raise ValidationError({"files": [f"Attach at most {MAX_ATTACHMENTS} files per message."]})
    validated = []
    for upload in files:
        try:
            ext, content_type = validate_upload(upload, MESSAGE_EXTENSIONS)
        except ValidationError as exc:
            detail = exc.detail.get("file", exc.detail) if isinstance(exc.detail, dict) else exc.detail
            reason = detail[0] if isinstance(detail, list) else detail
            raise ValidationError({"files": [f"{upload.name}: {reason}"]}) from None
        validated.append((upload, content_type))

    recipient = other_participant(conversation, user)
    message = Message.objects.create(conversation=conversation, sender=user, body=body)
    stored = []
    try:
        for upload, content_type in validated:
            attachment = MessageAttachment(
                message=message,
                uploaded_by=user,
                original_filename=upload.name[:255],
                content_type=content_type,
                size=upload.size,
            )
            attachment.file.save(upload.name, upload, save=False)
            stored.append(attachment)
            attachment.save()
    except Exception:
        for attachment in stored:  # the transaction rolls back; do not leave orphaned files behind
            attachment.file.storage.delete(attachment.file.name)
        raise

    Conversation.objects.filter(pk=conversation.pk).update(
        last_message_at=message.created_at, updated_at=timezone.now()
    )
    ConversationParticipant.objects.filter(conversation=conversation, user=user).update(
        last_read_message_id=message.id
    )
    if recipient is not None:
        sender_name = f"@{user.username}" if user.username else user.full_name
        if stored:
            notify_collapsed(
                recipient,
                Notification.Type.FILE_RECEIVED,
                f"{user.full_name} ({sender_name}) sent you {len(stored)} file{'s' if len(stored) != 1 else ''}",
                "Open Messages to download.",
                conversation,
            )
        else:
            notify_collapsed(
                recipient,
                Notification.Type.MESSAGE_RECEIVED,
                f"New message from {user.full_name} ({sender_name})",
                "Open Messages to read it.",
                conversation,
            )
    return message


def mark_read(user, conversation):
    last = Message.objects.filter(conversation=conversation).order_by("-id").values_list("id", flat=True).first() or 0
    ConversationParticipant.objects.filter(
        conversation=conversation, user=user, last_read_message_id__lt=last
    ).update(last_read_message_id=last)
    # Message notifications for this conversation are read too.
    Notification.objects.filter(
        recipient=user,
        is_read=False,
        type__in=[Notification.Type.MESSAGE_RECEIVED, Notification.Type.FILE_RECEIVED],
        entity_type=conversation._meta.label,
        entity_id=str(conversation.pk),
    ).update(is_read=True, read_at=timezone.now())
    return last
