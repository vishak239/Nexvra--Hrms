from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class LeaveType(TimeStampedModel):
    """Defined by HR. Nexvra has not specified any leave types; none are seeded in production."""

    name = models.CharField(max_length=80, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    is_paid = models.BooleanField(default=True)
    annual_allocation = models.DecimalField(
        max_digits=5,
        decimal_places=1,
        null=True,
        blank=True,
        help_text="Default yearly allocation. Empty = balances are not tracked for this type.",
    )
    allow_half_day = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(annual_allocation__isnull=True) | models.Q(annual_allocation__gte=0),
                name="leave_type_allocation_non_negative",
            )
        ]

    def __str__(self):
        return self.name

    @property
    def tracks_balance(self):
        return self.annual_allocation is not None


class LeaveBalance(TimeStampedModel):
    """Allocated days per employee/type/leave-year. Used and pending are computed from requests."""

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="leave_balances")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="balances")
    year = models.PositiveSmallIntegerField()
    allocated = models.DecimalField(max_digits=5, decimal_places=1)

    class Meta:
        ordering = ["-year", "leave_type__name"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "leave_type", "year"], name="leave_balance_unique"),
            models.CheckConstraint(condition=models.Q(allocated__gte=0), name="leave_balance_non_negative"),
        ]

    def __str__(self):
        return f"{self.employee_id} {self.leave_type_id} {self.year}: {self.allocated}"


class LeaveRequest(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    class Half(models.TextChoices):
        FIRST = "FIRST", "First half"
        SECOND = "SECOND", "Second half"

    ACTIVE_STATUSES = (Status.PENDING, Status.APPROVED)

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    is_half_day = models.BooleanField(default=False)
    half_day_period = models.CharField(max_length=6, choices=Half.choices, blank=True)
    days = models.DecimalField(
        max_digits=5, decimal_places=1, help_text="Snapshot of counted leave days at submission."
    )
    leave_year = models.PositiveSmallIntegerField()
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-start_date", "-id"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["employee", "start_date", "end_date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")), name="leave_end_after_start"
            ),
            models.CheckConstraint(
                condition=models.Q(is_half_day=False) | models.Q(start_date=models.F("end_date")),
                name="leave_half_day_single_date",
            ),
            models.CheckConstraint(condition=models.Q(days__gt=0), name="leave_days_positive"),
        ]

    def __str__(self):
        return f"{self.employee_id} {self.leave_type_id} {self.start_date}–{self.end_date} {self.status}"
