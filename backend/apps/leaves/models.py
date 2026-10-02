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

    @property
    def is_locked(self):
        """Approved leave is locked: the applicant can no longer cancel it."""
        return self.status == self.Status.APPROVED


class LeaveBalanceTransaction(models.Model):
    """Auditable ledger of balance changes. A DEDUCTION is written exactly once, in the same
    transaction that approves a request; the one-to-one link to the request is the database
    guarantee against double deduction (duplicate approvals, retries, concurrent requests).
    The used balance is the sum of deductions."""

    class Kind(models.TextChoices):
        DEDUCTION = "DEDUCTION", "Deducted on approval"

    balance = models.ForeignKey(LeaveBalance, on_delete=models.PROTECT, related_name="transactions")
    leave_request = models.OneToOneField(
        LeaveRequest, on_delete=models.PROTECT, related_name="balance_transaction"
    )
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.DEDUCTION)
    days = models.DecimalField(max_digits=5, decimal_places=1)
    balance_before = models.DecimalField(max_digits=6, decimal_places=1)
    balance_after = models.DecimalField(max_digits=6, decimal_places=1)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(days__gt=0), name="leave_txn_days_positive"),
            models.CheckConstraint(condition=models.Q(balance_after__gte=0), name="leave_txn_never_negative"),
        ]

    def __str__(self):
        return f"{self.kind} {self.days} from balance {self.balance_id}"
