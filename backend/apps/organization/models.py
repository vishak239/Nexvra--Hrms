import zoneinfo

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from apps.core.models import TimeStampedModel


class SingletonModel(TimeStampedModel):
    """Exactly one row (pk=1), enforced at the database level."""

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Company(SingletonModel):
    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=32, blank=True)
    website = models.URLField(blank=True)
    address = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "company"
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="company_singleton")]

    def __str__(self):
        return self.name


def validate_working_days(value):
    if not isinstance(value, list) or any(not isinstance(d, int) or d < 0 or d > 6 for d in value):
        raise ValidationError("Working days must be a list of weekday numbers 0 (Mon) to 6 (Sun).")
    if len(set(value)) != len(value):
        raise ValidationError("Working days must not contain duplicates.")


def validate_timezone(value):
    if value and value not in zoneinfo.available_timezones():
        raise ValidationError("Unknown time zone.")


class CompanySettings(SingletonModel):
    """HR policy settings. None of these were specified by Nexvra (see requirements-analysis.md §3):
    an empty value means the dependent rule is NOT applied."""

    timezone = models.CharField(max_length=64, blank=True, validators=[validate_timezone])
    currency = models.CharField(max_length=3, blank=True, help_text="ISO 4217 code, e.g. USD")
    working_days = models.JSONField(
        null=True, blank=True, validators=[validate_working_days], help_text="Weekday numbers, 0=Mon … 6=Sun"
    )
    work_start_time = models.TimeField(null=True, blank=True)
    work_end_time = models.TimeField(null=True, blank=True)
    late_grace_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    break_allowance_minutes = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        default=60,
        validators=[MinValueValidator(1), MaxValueValidator(480)],
        help_text="Total break time allowed per working day (owner policy: 60). Empty = no limit is applied.",
    )
    # Workplace geofence for office check-in. The rule applies once both coordinates are set.
    workplace_latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True,
        validators=[MinValueValidator(-90), MaxValueValidator(90)],
    )
    workplace_longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True,
        validators=[MinValueValidator(-180), MaxValueValidator(180)],
    )
    geofence_radius_m = models.PositiveSmallIntegerField(
        default=20, validators=[MinValueValidator(5), MaxValueValidator(1000)],
        help_text="Office check-in is allowed within this distance of the workplace (owner policy: 20 m).",
    )
    geofence_max_accuracy_m = models.PositiveSmallIntegerField(
        default=100, validators=[MinValueValidator(5), MaxValueValidator(5000)],
        help_text="Location readings less precise than this are not accepted for office check-in.",
    )
    inactivity_timeout_minutes = models.PositiveSmallIntegerField(
        null=True, blank=True, default=30, validators=[MinValueValidator(5), MaxValueValidator(480)],
        help_text="Automatic check-out / overtime stop after this much inactivity (owner policy: 30). Empty = off.",
    )
    overtime_requires_approval = models.BooleanField(
        default=True, help_text="Overtime requests must be approved by HR or a Super Admin before they can start."
    )
    half_day_min_hours = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    full_day_min_hours = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    self_attendance_enabled = models.BooleanField(default=True)
    leave_year_start_month = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    employee_document_upload_enabled = models.BooleanField(default=False)
    deactivate_user_on_exit = models.BooleanField(default=False)
    max_upload_size_mb = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(50)]
    )

    class Meta:
        verbose_name_plural = "company settings"
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="company_settings_singleton"),
            models.CheckConstraint(
                condition=models.Q(half_day_min_hours__isnull=True)
                | models.Q(full_day_min_hours__isnull=True)
                | models.Q(half_day_min_hours__lt=models.F("full_day_min_hours")),
                name="half_day_below_full_day",
            ),
            models.CheckConstraint(
                condition=models.Q(workplace_latitude__isnull=True, workplace_longitude__isnull=True)
                | models.Q(workplace_latitude__isnull=False, workplace_longitude__isnull=False),
                name="workplace_both_coordinates_or_neither",
            ),
        ]

    def clean(self):
        if (self.half_day_min_hours is None) != (self.full_day_min_hours is None):
            raise ValidationError("Set both half-day and full-day minimum hours, or neither.")
        if (self.workplace_latitude is None) != (self.workplace_longitude is None):
            raise ValidationError("Set both workplace latitude and longitude, or neither.")
        if self.work_start_time and self.work_end_time and self.work_end_time <= self.work_start_time:
            raise ValidationError({"work_end_time": "Must be after work start time."})

    @property
    def geofence_configured(self):
        return self.workplace_latitude is not None and self.workplace_longitude is not None

    @property
    def tz(self):
        return zoneinfo.ZoneInfo(self.timezone or settings.TIME_ZONE)

    def today(self):
        return timezone.localtime(timezone.now(), self.tz).date()

    def is_working_day(self, day):
        """True if no working days are configured (rule not applied) or the weekday is configured."""
        return not self.working_days or day.weekday() in self.working_days

    def leave_year_for(self, day):
        start = self.leave_year_start_month or 1
        return day.year if day.month >= start else day.year - 1


class Department(TimeStampedModel):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    head = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="headed_departments"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Designation(TimeStampedModel):
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Holiday(TimeStampedModel):
    date = models.DateField(db_index=True)
    name = models.CharField(max_length=120)
    is_optional = models.BooleanField(default=False, help_text="Optional holidays do not reduce leave day counts.")

    class Meta:
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["date", "name"], name="holiday_unique_date_name")]

    def __str__(self):
        return f"{self.date} {self.name}"


class Policy(TimeStampedModel):
    """A company policy document written by HR (e.g. conduct or communication rules).

    Nexvra supplied no policy texts, so none are seeded. Numeric rules that the system
    enforces (working hours, grace time, break allowance, ...) live in CompanySettings,
    not here, so each value has exactly one source.
    """

    class Category(models.TextChoices):
        WORKING_HOURS = "WORKING_HOURS", "Working hours"
        ATTENDANCE = "ATTENDANCE", "Attendance"
        BREAKS = "BREAKS", "Breaks"
        LEAVE = "LEAVE", "Leave"
        HOLIDAYS = "HOLIDAYS", "Holidays"
        CONDUCT = "CONDUCT", "Employee conduct"
        COMMUNICATION = "COMMUNICATION", "Communication"
        OTHER = "OTHER", "Other"

    title = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    body = models.TextField()
    effective_date = models.DateField(null=True, blank=True)
    is_published = models.BooleanField(default=False, help_text="Drafts are visible only to policy managers.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["category", "title"]
        verbose_name_plural = "policies"
        indexes = [models.Index(fields=["is_published", "category"], name="policy_published_category")]
        constraints = [models.UniqueConstraint(Lower("title"), name="policy_unique_title_ci")]

    def __str__(self):
        return self.title
