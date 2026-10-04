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

    class Mode(models.TextChoices):
        OFFICE = "OFFICE", "Office"
        WORK_FROM_HOME = "WORK_FROM_HOME", "Work from home"

    class CheckoutReason(models.TextChoices):
        MANUAL = "MANUAL", "Checked out by the employee"
        GEO_FENCE_EXIT = "GEO_FENCE_EXIT", "Left the workplace area"
        INACTIVITY_TIMEOUT = "INACTIVITY_TIMEOUT", "No activity"
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
    mode = models.CharField(max_length=16, choices=Mode.choices, default=Mode.OFFICE)
    wfh_request = models.ForeignKey(
        "attendance.WorkFromHomeRequest", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    checkout_reason = models.CharField(max_length=20, choices=CheckoutReason.choices, blank=True)
    # Location metadata (office check-ins only; never collected for work from home). The
    # coordinates are not exposed through the API; distances are.
    check_in_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    check_in_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    check_in_accuracy_m = models.PositiveIntegerField(null=True, blank=True)
    check_in_distance_m = models.PositiveIntegerField(null=True, blank=True)
    check_out_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    check_out_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    check_out_distance_m = models.PositiveIntegerField(null=True, blank=True)
    # Activity heartbeat (privacy-safe: only a timestamp, never what the user did).
    last_activity_at = models.DateTimeField(null=True, blank=True)
    location_issue = models.CharField(max_length=24, blank=True, help_text="Last location-monitoring problem.")
    location_issue_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-date", "employee_id"]
        indexes = [
            models.Index(fields=["date"]),
            models.Index(
                fields=["last_activity_at"],
                condition=models.Q(check_out__isnull=True, check_in__isnull=False),
                name="attendance_open_activity",
            ),
        ]
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
    class EndReason(models.TextChoices):
        MANUAL = "MANUAL", "Ended by the employee"
        ALLOWANCE_EXHAUSTED = "ALLOWANCE_EXHAUSTED", "Daily break allowance used up"
        CHECKOUT = "CHECKOUT", "Ended at check-out"

    status = models.CharField(max_length=10, choices=SessionStatus.choices, default=SessionStatus.ACTIVE)
    source = models.CharField(max_length=8, choices=SessionSource.choices, default=SessionSource.ONLINE)
    end_reason = models.CharField(max_length=20, choices=EndReason.choices, blank=True)

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


class OvertimeStatus(models.TextChoices):
    REQUESTED = "REQUESTED", "Requested"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    ACTIVE = "ACTIVE", "Running"
    AUTO_STOPPED = "AUTO_STOPPED", "Stopped automatically"
    COMPLETED = "COMPLETED", "Completed"
    CANCELLED = "CANCELLED", "Cancelled"


OVERTIME_OPEN = (OvertimeStatus.REQUESTED, OvertimeStatus.APPROVED)
OVERTIME_ENDED = (OvertimeStatus.COMPLETED, OvertimeStatus.AUTO_STOPPED)


class OvertimeSession(TimeStampedModel):
    """One overtime session, from the employee's declaration to its end.

    Overtime is recorded separately from normal attendance and never added to its worked
    time. It can only start after the day's normal check-out. Workflow (server-controlled):

        REQUESTED -> APPROVED -> ACTIVE -> COMPLETED | AUTO_STOPPED
        REQUESTED -> REJECTED;  REQUESTED/APPROVED -> CANCELLED

    When CompanySettings.overtime_requires_approval is off, a valid declaration starts the
    session directly (ACTIVE). Every session, including a restart after an automatic stop,
    is its own row with its own declaration."""

    class Trigger(models.TextChoices):
        AFTER_CHECKOUT = "AFTER_CHECKOUT", "Started after normal check-out"

    class EndReason(models.TextChoices):
        MANUAL = "MANUAL", "Ended by the employee"
        OVERTIME_INACTIVITY_TIMEOUT = "OVERTIME_INACTIVITY_TIMEOUT", "No activity"
        EXPIRED = "EXPIRED", "Approval expired unused"

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="overtime_sessions")
    attendance = models.ForeignKey(
        AttendanceRecord, null=True, blank=True, on_delete=models.SET_NULL, related_name="overtime_sessions"
    )
    date = models.DateField(help_text="Company-local date of the overtime (request date).")
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=OvertimeStatus.choices, default=OvertimeStatus.ACTIVE)
    trigger = models.CharField(max_length=16, choices=Trigger.choices, default=Trigger.AFTER_CHECKOUT)
    source = models.CharField(max_length=8, choices=SessionSource.choices, default=SessionSource.ONLINE)
    # Declaration captured before any overtime (blank only on sessions recorded before it existed).
    tasks = models.ManyToManyField("tasks.Task", blank=True, related_name="overtime_sessions")
    work_description = models.TextField(blank=True)
    other_reason = models.TextField(blank=True)
    declaration_confirmed = models.BooleanField(default=False)
    requested_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True)
    end_reason = models.CharField(max_length=32, choices=EndReason.choices, blank=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["date"]),
            models.Index(fields=["employee", "started_at"]),
            models.Index(fields=["status", "date"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["employee"],
                condition=models.Q(status=OvertimeStatus.ACTIVE),
                name="overtime_one_active_per_employee",
            ),
            models.UniqueConstraint(
                fields=["employee"],
                condition=models.Q(status__in=OVERTIME_OPEN),
                name="overtime_one_open_request_per_employee",
            ),
            models.CheckConstraint(
                condition=models.Q(ended_at__isnull=True)
                | (models.Q(started_at__isnull=False) & models.Q(ended_at__gte=models.F("started_at"))),
                name="overtime_end_after_start",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=[*OVERTIME_OPEN, OvertimeStatus.REJECTED, OvertimeStatus.CANCELLED],
                    started_at__isnull=True,
                    ended_at__isnull=True,
                )
                | models.Q(status=OvertimeStatus.ACTIVE, started_at__isnull=False, ended_at__isnull=True)
                | models.Q(
                    status__in=OVERTIME_ENDED,
                    started_at__isnull=False,
                    ended_at__isnull=False,
                    duration_seconds__isnull=False,
                ),
                name="overtime_status_matches_times",
            ),
        ]

    def __str__(self):
        return f"{self.employee_id} overtime {self.date} {self.status}"


class WorkFromHomeRequest(TimeStampedModel):
    """Permission to work from home on one date. Only an APPROVED request for today lets the
    employee check in with mode WORK_FROM_HOME (verified by the server, never by the client)."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="wfh_requests")
    date = models.DateField()
    reason = models.CharField(max_length=500)
    remarks = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name = "work-from-home request"
        indexes = [models.Index(fields=["status", "date"]), models.Index(fields=["employee", "date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["employee", "date"],
                condition=models.Q(status__in=["PENDING", "APPROVED"]),
                name="wfh_one_open_request_per_day",
            )
        ]

    def __str__(self):
        return f"{self.employee_id} WFH {self.date} {self.status}"


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
