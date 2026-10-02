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
        FILE_RECEIVED = "FILE_RECEIVED", "File received"
        OVERTIME_STARTED = "OVERTIME_STARTED", "Overtime started"
        OVERTIME_COMPLETED = "OVERTIME_COMPLETED", "Overtime completed"
        SYNC_STATUS = "SYNC_STATUS", "Offline sync status"
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
