from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        LEAVE_SUBMITTED = "LEAVE_SUBMITTED", "Leave submitted"
        LEAVE_APPROVED = "LEAVE_APPROVED", "Leave approved"
        LEAVE_REJECTED = "LEAVE_REJECTED", "Leave rejected"
        LEAVE_CANCELLED = "LEAVE_CANCELLED", "Leave cancelled"
        PAYSLIP_PUBLISHED = "PAYSLIP_PUBLISHED", "Payslip published"
        DOCUMENT_SHARED = "DOCUMENT_SHARED", "Document shared"
        TASK_ASSIGNED = "TASK_ASSIGNED", "Task assigned"
        TASK_REMINDER = "TASK_REMINDER", "Task reminder"
        TASK_RESPONSE = "TASK_RESPONSE", "Task response"
        TASK_COMPLETED = "TASK_COMPLETED", "Task completed"
        TASK_CANCELLED = "TASK_CANCELLED", "Task cancelled"
        MESSAGE_RECEIVED = "MESSAGE_RECEIVED", "Message received"
        GROUP_MESSAGE_RECEIVED = "GROUP_MESSAGE_RECEIVED", "Group message received"
        GROUP_ADDED = "GROUP_ADDED", "Added to a group"
        FILE_RECEIVED = "FILE_RECEIVED", "File received"
        OVERTIME_STARTED = "OVERTIME_STARTED", "Overtime started"
        OVERTIME_COMPLETED = "OVERTIME_COMPLETED", "Overtime completed"
        SYNC_STATUS = "SYNC_STATUS", "Offline sync status"
        WFH_REQUESTED = "WFH_REQUESTED", "Work from home requested"
        WFH_APPROVED = "WFH_APPROVED", "Work from home approved"
        WFH_REJECTED = "WFH_REJECTED", "Work from home rejected"
        OVERTIME_REQUESTED = "OVERTIME_REQUESTED", "Overtime requested"
        OVERTIME_APPROVED = "OVERTIME_APPROVED", "Overtime approved"
        OVERTIME_REJECTED = "OVERTIME_REJECTED", "Overtime rejected"
        OVERTIME_AUTO_STOPPED = "OVERTIME_AUTO_STOPPED", "Overtime stopped automatically"
        ATTENDANCE_AUTO_CHECKOUT = "ATTENDANCE_AUTO_CHECKOUT", "Automatic check-out"
        BREAK_AUTO_ENDED = "BREAK_AUTO_ENDED", "Break ended automatically"
        PASSWORD_CHANGED = "PASSWORD_CHANGED", "Password changed"
        MEETING_SCHEDULED = "MEETING_SCHEDULED", "Meeting scheduled"
        MEETING_STARTED = "MEETING_STARTED", "Meeting started"
        MEETING_ENDED = "MEETING_ENDED", "Meeting ended"
        MEETING_CANCELLED = "MEETING_CANCELLED", "Meeting cancelled"
        RESUME_REQUESTED = "RESUME_REQUESTED", "Resume work requested"
        RESUME_APPROVED = "RESUME_APPROVED", "Resume work approved"
        RESUME_REJECTED = "RESUME_REJECTED", "Resume work rejected"
        GENERAL = "GENERAL", "General"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=32, choices=Type.choices, default=Type.GENERAL)
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True)
    entity_type = models.CharField(max_length=64, blank=True)
    entity_id = models.CharField(max_length=64, blank=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["recipient", "is_read", "-created_at"])]

    def __str__(self):
        return f"{self.recipient_id}: {self.title}"


class SmsMessage(models.Model):
    """Persistent, idempotent record of every outbound SMS.

    One row per intended delivery. The idempotency key (purpose + phone + reference) makes
    retries safe: sending the same logical message twice produces one row and one provider
    call. Delivery status and the provider message id are recorded here; message bodies and
    phone numbers are personal data and are never logged by the provider client.
    """

    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        SENT = "SENT", "Sent by provider"
        FAILED = "FAILED", "Provider rejected the message"
        UNDELIVERED = "UNDELIVERED", "Provider accepted but did not deliver"

    class Purpose(models.TextChoices):
        BREAK_REMINDER = "BREAK_REMINDER", "Break-end reminder"
        WELCOME = "WELCOME", "New employee welcome"

    phone = models.CharField(max_length=32, db_index=True)
    body = models.TextField()
    purpose = models.CharField(max_length=32, choices=Purpose.choices)
    reference = models.CharField(max_length=128, blank=True, help_text="Business id for idempotency.")
    idempotency_key = models.CharField(max_length=128, unique=True, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    provider_message_id = models.CharField(max_length=128, blank=True)
    provider_error = models.TextField(blank=True)
    scheduled_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "scheduled_at"], name="sms_due_queue"),
            models.Index(fields=["purpose", "reference"], name="sms_purpose_reference"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["purpose", "reference"], name="sms_one_per_purpose_reference"
            ),
        ]

    def __str__(self):
        return f"{self.purpose} {self.phone[-4:] if self.phone else ''} {self.status}"
