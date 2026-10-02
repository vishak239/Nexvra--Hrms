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
    def worked_minutes(self):
        if self.check_in and self.check_out:
            return int((self.check_out - self.check_in).total_seconds() // 60)
        return None
