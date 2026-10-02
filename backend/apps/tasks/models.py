from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class Task(TimeStampedModel):
    """A task HR assigns to one employee.

    The assignee is stored as a foreign key to the Employee record (internal id). HR may look
    the person up by Employee ID or @username, but neither is stored as the relationship, so
    renaming a username never detaches a task.

    OVERDUE is not stored: it is derived (open task whose due date has passed) so it is always
    correct without a background job. See `display_status`.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        URGENT = "URGENT", "Urgent"

    OVERDUE = "OVERDUE"
    OPEN_STATUSES = (Status.PENDING, Status.IN_PROGRESS)

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="tasks_assigned"
    )
    assigned_to = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="tasks")
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.MEDIUM)
    due_date = models.DateField(null=True, blank=True)
    requires_response = models.BooleanField(
        default=True,
        help_text="The employee must respond before they can check out (see apps/tasks/rules.py).",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    response = models.TextField(blank=True, help_text="Latest response from the assignee.")
    responded_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    cancel_reason = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["assigned_to", "status"]),
            models.Index(fields=["status", "due_date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(status="COMPLETED") | models.Q(completed_at__isnull=False),
                name="task_completed_has_time",
            ),
            models.CheckConstraint(
                condition=~models.Q(status="CANCELLED") | models.Q(cancelled_at__isnull=False),
                name="task_cancelled_has_time",
            ),
        ]

    def __str__(self):
        return f"#{self.pk} {self.title} -> {self.assigned_to_id} ({self.status})"

    @property
    def is_open(self):
        return self.status in self.OPEN_STATUSES

    def is_overdue(self, today):
        return self.is_open and self.due_date is not None and self.due_date < today

    def display_status(self, today):
        return self.OVERDUE if self.is_overdue(today) else self.status


class TaskResponse(models.Model):
    """History of everything the assignee wrote on a task (latest is mirrored on Task.response)."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="responses")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"Response to task {self.task_id}"
