from django.conf import settings
from django.db import models

from apps.core.files import RandomUploadPath
from apps.core.models import TimeStampedModel


class Conversation(TimeStampedModel):
    """A private conversation: one-to-one (DIRECT) or a named GROUP. For DIRECT, `pair_key`
    ("<low user id>:<high user id>") makes exactly one conversation per pair of people; groups
    have no pair key. Only members can read a conversation - there is no administrative read
    access to message contents."""

    class Kind(models.TextChoices):
        DIRECT = "DIRECT", "Direct message"
        GROUP = "GROUP", "Group"

    kind = models.CharField(max_length=6, choices=Kind.choices, default=Kind.DIRECT)
    name = models.CharField(max_length=80, blank=True, help_text="Group name (groups only).")
    pair_key = models.CharField(max_length=41, unique=True, null=True, blank=True)
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL, through="ConversationParticipant", related_name="conversations"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-last_message_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(kind="DIRECT", pair_key__isnull=False)
                | models.Q(kind="GROUP", pair_key__isnull=True),
                name="conversation_pair_key_matches_kind",
            )
        ]

    def __str__(self):
        return f"Group {self.name}" if self.kind == self.Kind.GROUP else f"Conversation {self.pair_key}"

    @property
    def is_group(self):
        return self.kind == self.Kind.GROUP

    @staticmethod
    def key_for(user_a_id, user_b_id):
        low, high = sorted((int(user_a_id), int(user_b_id)))
        return f"{low}:{high}"


class ConversationParticipant(models.Model):
    """Membership. The two watermarks drive unread counts and read receipts without one row per
    message: messages up to `last_delivered_message_id` reached the member's app, messages up to
    `last_read_message_id` were seen in the open conversation. Both only move forward."""

    class Role(models.TextChoices):
        OWNER = "OWNER", "Owner"
        MEMBER = "MEMBER", "Member"

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversation_memberships"
    )
    role = models.CharField(max_length=6, choices=Role.choices, default=Role.MEMBER)
    last_read_message_id = models.BigIntegerField(
        default=0, help_text="Read watermark: messages up to this id are read."
    )
    last_delivered_message_id = models.BigIntegerField(
        default=0, help_text="Delivery watermark: messages up to this id reached the member's app."
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["conversation", "user"], name="conversation_participant_unique")]
        indexes = [models.Index(fields=["user", "conversation"])]

    def __str__(self):
        return f"{self.user_id} in {self.conversation_id}"


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["conversation", "id"])]

    def __str__(self):
        return f"Message {self.pk} in {self.conversation_id}"


class MessageAttachment(models.Model):
    """A work file sent in a message. Stored in private storage under a random name and only
    downloadable by participants of the conversation, through the API."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    file = models.FileField(upload_to=RandomUploadPath("message_files"))
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.original_filename
