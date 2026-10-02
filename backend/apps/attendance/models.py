from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class AttendanceRecord(TimeStampedModel):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        HALF_DAY = "HALF_DAY", "Half day"
        ABSENT = "ABSENT", "Absent"

    class Source(models.TextChoices):
        SELF = "SELF", "Self check-in"
        ADMIN = "ADMIN", "Recorded by HR"

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="attendance_records")
    date = models.DateField()
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PRESENT)
    is_late = models.BooleanField(default=False)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.SELF)
    remarks = models.CharField(max_length=255, blank=True)
    total_break_seconds = models.PositiveIntegerField(
        default=0, help_text="Sum of completed breaks; maintained by the break services, never sent by clients."
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-date", "employee_id"]
        indexes = [models.Index(fields=["date"])]
        constraints = [
            models.UniqueConstraint(fields=["employee", "date"], name="attendance_one_per_day"),
            models.CheckConstraint(
                condition=models.Q(check_out__isnull=True)
                | (models.Q(check_in__isnull=False) & models.Q(check_out__gte=models.F("check_in"))),
                name="attendance_checkout_after_checkin",
            ),
        ]

    def __str__(self):
        return f"{self.employee_id} {self.date} {self.status}"

    @property
    def session_minutes(self):
        """Check-in to check-out, breaks included."""
        if self.check_in and self.check_out:
            return int((self.check_out - self.check_in).total_seconds() // 60)
        return None

    @property
    def break_minutes(self):
        return self.total_break_seconds // 60

    @property
    def worked_minutes(self):
        """Actual working time = total session time - total break time (breaks are not work)."""
        if self.check_in and self.check_out:
            seconds = (self.check_out - self.check_in).total_seconds() - self.total_break_seconds
            return max(0, int(seconds // 60))
        return None


class SessionSource(models.TextChoices):
    ONLINE = "ONLINE", "Recorded online"
    OFFLINE = "OFFLINE", "Synchronised from offline mode"


class SessionStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    COMPLETED = "COMPLETED", "Completed"


def _status_matches_end():
    return models.Q(status=SessionStatus.ACTIVE, ended_at__isnull=True, duration_seconds__isnull=True) | models.Q(
        status=SessionStatus.COMPLETED, ended_at__isnull=False, duration_seconds__isnull=False
    )


class BreakSession(TimeStampedModel):
    """A break inside one day's work session (AttendanceRecord). Several per day are allowed;
    at most one can be active, and breaks never overlap (enforced in services + constraints)."""

    attendance = models.ForeignKey(AttendanceRecord, on_delete=models.CASCADE, related_name="breaks")
    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="breaks")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=SessionStatus.choices, default=SessionStatus.ACTIVE)
    source = models.CharField(max_length=8, choices=SessionSource.choices, default=SessionSource.ONLINE)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [models.Index(fields=["employee", "started_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["employee"],
                condition=models.Q(status=SessionStatus.ACTIVE),
                name="break_one_active_per_employee",
            ),
            models.CheckConstraint(
                condition=models.Q(ended_at__isnull=True) | models.Q(ended_at__gte=models.F("started_at")),
                name="break_end_after_start",
            ),
            models.CheckConstraint(condition=_status_matches_end(), name="break_status_matches_end"),
        ]

    def __str__(self):
        return f"{self.employee_id} break {self.started_at:%Y-%m-%d %H:%M} {self.status}"


class OvertimeSession(TimeStampedModel):
    """Overtime is recorded separately from normal attendance and never added to its
    worked time. It can only start after the day's normal check-out."""

    class Trigger(models.TextChoices):
        AFTER_CHECKOUT = "AFTER_CHECKOUT", "Started after normal check-out"

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="overtime_sessions")
    attendance = models.ForeignKey(
        AttendanceRecord, null=True, blank=True, on_delete=models.SET_NULL, related_name="overtime_sessions"
    )
    date = models.DateField(help_text="Company-local date the overtime started.")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=SessionStatus.choices, default=SessionStatus.ACTIVE)
    trigger = models.CharField(max_length=16, choices=Trigger.choices, default=Trigger.AFTER_CHECKOUT)
    source = models.CharField(max_length=8, choices=SessionSource.choices, default=SessionSource.ONLINE)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [models.Index(fields=["date"]), models.Index(fields=["employee", "started_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["employee"],
                condition=models.Q(status=SessionStatus.ACTIVE),
                name="overtime_one_active_per_employee",
            ),
            models.CheckConstraint(
                condition=models.Q(ended_at__isnull=True) | models.Q(ended_at__gte=models.F("started_at")),
                name="overtime_end_after_start",
            ),
            models.CheckConstraint(condition=_status_matches_end(), name="overtime_status_matches_end"),
        ]

    def __str__(self):
        return f"{self.employee_id} overtime {self.date} {self.status}"


class SyncEvent(models.Model):
    """Idempotency + audit record for work-session events (break/overtime start/end).

    Every event carries a client-generated UUID. (user, client_event_id) is unique, so a
    retried or re-synchronised event is never applied twice. Offline events keep the
    client-reported time separately from the server receive time."""

    class Type(models.TextChoices):
        BREAK_START = "BREAK_START", "Break started"
        BREAK_END = "BREAK_END", "Break ended"
        OVERTIME_START = "OVERTIME_START", "Overtime started"
        OVERTIME_END = "OVERTIME_END", "Overtime ended"

    class Channel(models.TextChoices):
        ONLINE = "ONLINE", "Online"
        OFFLINE = "OFFLINE", "Offline queue"

    class Status(models.TextChoices):
        APPLIED = "APPLIED", "Applied"
        CONFLICT = "CONFLICT", "Conflict (not applied)"
        REJECTED = "REJECTED", "Rejected (not applied)"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_events")
    employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.CASCADE, related_name="sync_events"
    )
    client_event_id = models.UUIDField()
    event_type = models.CharField(max_length=16, choices=Type.choices)
    channel = models.CharField(max_length=8, choices=Channel.choices)
    client_timestamp = models.DateTimeField(null=True, blank=True, help_text="Time reported by the device.")
    effective_at = models.DateTimeField(null=True, blank=True, help_text="Time the server applied the event at.")
    received_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=8, choices=Status.choices)
    error = models.CharField(max_length=500, blank=True)
    entity_type = models.CharField(max_length=64, blank=True)
    entity_id = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-received_at", "-id"]
        indexes = [models.Index(fields=["status"]), models.Index(fields=["channel", "received_at"])]
        constraints = [
            models.UniqueConstraint(fields=["user", "client_event_id"], name="sync_event_unique_per_user")
        ]

    def __str__(self):
        return f"{self.user_id} {self.event_type} {self.status}"
