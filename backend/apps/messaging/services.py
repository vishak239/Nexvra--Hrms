"""Private messaging: one-to-one conversations and named groups.

Membership is the only way in: every query is restricted to the caller's conversations, so other
conversations, their files and their read receipts are invisible (404). Message contents never go
into notifications or receipts.

Read receipts come from two per-member watermarks (no row per message):
* delivered - the member's app picked the message up (their background poll or opening Messages);
* seen      - the member had the conversation open.
A message's status for its sender is derived from the other members' watermarks, counting only
members who were already in the conversation when it was sent.
"""

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, F, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.core.files import MESSAGE_EXTENSIONS, validate_upload
from apps.notifications.models import Notification
from apps.notifications.services import notify, notify_collapsed

from .models import Conversation, ConversationParticipant, Message, MessageAttachment

MAX_ATTACHMENTS = 5
MAX_BODY_LENGTH = 5000
GROUP_NAME_MIN, GROUP_NAME_MAX = 2, 80
GROUP_MIN_OTHERS = 2  # a group is at least three people; two people use a direct message
GROUP_MAX_MEMBERS = 50


def can_message(user):
    return user.is_active and user.has_permission("messages.use")


def display_name(user):
    return f"{user.full_name} (@{user.username})" if user.username else user.full_name


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
        .prefetch_related("memberships__user__employee__designation", "memberships__user__employee__department")
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


def membership(conversation, user):
    return next((m for m in conversation.memberships.all() if m.user_id == user.pk), None)


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
    """The other person of a direct conversation (None for groups)."""
    if conversation.is_group:
        return None
    for m in conversation.memberships.all():
        if m.user_id != user.pk:
            return m.user
    return None


# --- groups ------------------------------------------------------------------------------


def _clean_group_name(name):
    name = " ".join((name or "").split())
    if not GROUP_NAME_MIN <= len(name) <= GROUP_NAME_MAX:
        raise ValidationError({"name": [f"Give the group a name of {GROUP_NAME_MIN}-{GROUP_NAME_MAX} characters."]})
    return name


def _eligible_users(user_ids, exclude_ids):
    """Active colleagues who can use messages; duplicates and the excluded ids are dropped."""
    ids = [i for i in dict.fromkeys(user_ids) if i not in exclude_ids]
    users = list(User.objects.filter(pk__in=ids).select_related("employee"))
    found = {u.pk for u in users}
    missing = [i for i in ids if i not in found]
    if missing:
        raise ValidationError({"user_ids": ["Some selected people were not found."]})
    blocked = [u.full_name for u in users if not can_message(u)]
    if blocked:
        raise ValidationError({"user_ids": [f"These people cannot receive messages: {', '.join(sorted(blocked))}."]})
    return users


@transaction.atomic
def create_group(user, name, user_ids):
    name = _clean_group_name(name)
    members = _eligible_users(user_ids, {user.pk})
    if len(members) < GROUP_MIN_OTHERS:
        raise ValidationError({"user_ids": [f"Choose at least {GROUP_MIN_OTHERS} colleagues for a group."]})
    if len(members) + 1 > GROUP_MAX_MEMBERS:
        raise ValidationError({"user_ids": [f"A group can have at most {GROUP_MAX_MEMBERS} members."]})
    conversation = Conversation.objects.create(kind=Conversation.Kind.GROUP, name=name, created_by=user)
    ConversationParticipant.objects.bulk_create(
        [ConversationParticipant(conversation=conversation, user=user, role=ConversationParticipant.Role.OWNER)]
        + [ConversationParticipant(conversation=conversation, user=m) for m in members]
    )
    notify(members, Notification.Type.GROUP_ADDED, f"{display_name(user)} added you to the group {name}",
           "Open Messages to join the conversation.", obj=conversation)
    return conversation


def _require_group(conversation):
    if not conversation.is_group:
        raise ValidationError({"detail": ["This is a direct conversation, not a group."]})


def _require_owner(conversation, user):
    m = membership(conversation, user)
    if m is None or m.role != ConversationParticipant.Role.OWNER:
        raise PermissionDenied("Only the group owner can do this.")


@transaction.atomic
def rename_group(user, conversation, name):
    _require_group(conversation)
    _require_owner(conversation, user)
    conversation.name = _clean_group_name(name)
    conversation.save(update_fields=["name", "updated_at"])
    return conversation


@transaction.atomic
def add_members(user, conversation, user_ids):
    _require_group(conversation)
    _require_owner(conversation, user)
    current = set(conversation.memberships.values_list("user_id", flat=True))
    new = _eligible_users(user_ids, current)
    if not new:
        raise ValidationError({"user_ids": ["Choose at least one colleague who is not in the group yet."]})
    if len(current) + len(new) > GROUP_MAX_MEMBERS:
        raise ValidationError({"user_ids": [f"A group can have at most {GROUP_MAX_MEMBERS} members."]})
    last = Message.objects.filter(conversation=conversation).order_by("-id").values_list("id", flat=True).first() or 0
    # Newcomers see the history, but earlier messages are neither unread for them nor waiting on them.
    ConversationParticipant.objects.bulk_create(
        [ConversationParticipant(conversation=conversation, user=u, last_read_message_id=last,
                                 last_delivered_message_id=last) for u in new]
    )
    notify(new, Notification.Type.GROUP_ADDED, f"{display_name(user)} added you to the group {conversation.name}",
           "Open Messages to join the conversation.", obj=conversation)
    return new


@transaction.atomic
def remove_member(user, conversation, member_id):
    """The owner removes someone, or anyone leaves. A leaving owner hands the group to the longest
    standing member. Removed members lose access to the conversation and its files."""
    _require_group(conversation)
    target = (
        ConversationParticipant.objects.select_for_update()
        .filter(conversation=conversation, user_id=member_id)
        .first()
    )
    if target is None:
        raise ValidationError({"user_id": ["This person is not in the group."]})
    if member_id != user.pk:
        _require_owner(conversation, user)
    was_owner = target.role == ConversationParticipant.Role.OWNER
    target.delete()
    if was_owner:
        heir = ConversationParticipant.objects.filter(conversation=conversation).order_by("joined_at", "id").first()
        if heir is not None:
            heir.role = ConversationParticipant.Role.OWNER
            heir.save(update_fields=["role"])


# --- sending, delivery, reading -------------------------------------------------------------


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

    recipients = [m.user for m in conversation.memberships.all() if m.user_id != user.pk]
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
        last_read_message_id=message.id, last_delivered_message_id=message.id
    )
    files_text = f"{len(stored)} file{'s' if len(stored) != 1 else ''}"
    for recipient in recipients:
        if conversation.is_group:
            title = (f"{display_name(user)} sent {files_text} in {conversation.name}" if stored
                     else f"New message in {conversation.name} from {display_name(user)}")
            kind = Notification.Type.FILE_RECEIVED if stored else Notification.Type.GROUP_MESSAGE_RECEIVED
        else:
            title = (f"{display_name(user)} sent you {files_text}" if stored
                     else f"New message from {display_name(user)}")
            kind = Notification.Type.FILE_RECEIVED if stored else Notification.Type.MESSAGE_RECEIVED
        hint = "Open Messages to download." if stored else "Open Messages to read it."
        notify_collapsed(recipient, kind, title, hint, conversation)
    return message


def mark_delivered(user):
    """Move the caller's delivery watermark to the newest message of each conversation that has
    something new. One UPDATE, and only rows that actually change are written."""
    newest = Message.objects.filter(conversation=OuterRef("conversation")).order_by("-id").values("id")[:1]
    newer = Message.objects.filter(conversation=OuterRef("conversation"), id__gt=OuterRef("last_delivered_message_id"))
    return (
        ConversationParticipant.objects.filter(user=user)
        .filter(Exists(newer))
        .update(last_delivered_message_id=Subquery(newest))
    )


def mark_read(user, conversation):
    last = Message.objects.filter(conversation=conversation).order_by("-id").values_list("id", flat=True).first() or 0
    ConversationParticipant.objects.filter(
        conversation=conversation, user=user, last_read_message_id__lt=last
    ).update(last_read_message_id=last)
    ConversationParticipant.objects.filter(
        conversation=conversation, user=user, last_delivered_message_id__lt=last
    ).update(last_delivered_message_id=last)
    # Message notifications for this conversation are read too.
    Notification.objects.filter(
        recipient=user,
        is_read=False,
        type__in=[Notification.Type.MESSAGE_RECEIVED, Notification.Type.GROUP_MESSAGE_RECEIVED,
                  Notification.Type.FILE_RECEIVED, Notification.Type.GROUP_ADDED],
        entity_type=conversation._meta.label,
        entity_id=str(conversation.pk),
    ).update(is_read=True, read_at=timezone.now())
    return last


def receipts(conversation, messages, user):
    """{message id: {status, recipient_count, delivered_count, read_count, seen_by}} for the caller's
    own messages. Only members who were in the conversation when a message was sent count."""
    members = [m for m in conversation.memberships.all() if m.user_id != user.pk]
    out = {}
    for msg in messages:
        if msg.sender_id != user.pk:
            continue
        audience = [m for m in members if m.joined_at <= msg.created_at]
        seen = [m.user_id for m in audience if m.last_read_message_id >= msg.id]
        delivered = [m for m in audience if max(m.last_delivered_message_id, m.last_read_message_id) >= msg.id]
        total = len(audience)
        if total and len(seen) == total:
            status = "seen"
        elif total and len(delivered) == total:
            status = "delivered"
        else:
            status = "sent"
        out[msg.id] = {
            "status": status,
            "recipient_count": total,
            "delivered_count": len(delivered),
            "read_count": len(seen),
            "seen_by": seen if conversation.is_group else [],
        }
    return out
