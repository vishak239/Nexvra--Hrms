import hashlib

from django.conf import settings
from django.db import models

from apps.core.files import RandomUploadPath
from apps.core.models import TimeStampedModel


class Employee(TimeStampedModel):
    """HR record for a person. Name and email live on the linked User (single source)."""

    class EmploymentType(models.TextChoices):
        FULL_TIME = "FULL_TIME", "Full-time"
        PART_TIME = "PART_TIME", "Part-time"
        CONTRACT = "CONTRACT", "Contract"
        INTERN = "INTERN", "Intern"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        PROBATION = "PROBATION", "Probation"
        NOTICE_PERIOD = "NOTICE_PERIOD", "Notice period"
        EXITED = "EXITED", "Exited"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="employee")
    employee_code = models.CharField(max_length=32, unique=True)
    phone = models.CharField(max_length=32, blank=True)
    joining_date = models.DateField()
    exit_date = models.DateField(null=True, blank=True)
    department = models.ForeignKey(
        "organization.Department", null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    designation = models.ForeignKey(
        "organization.Designation", null=True, blank=True, on_delete=models.PROTECT, related_name="employees"
    )
    manager = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="direct_reports"
    )
    employment_type = models.CharField(max_length=16, choices=EmploymentType.choices)
    employment_status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    address = models.TextField(blank=True)
    emergency_contact_name = models.CharField(max_length=120, blank=True)
    emergency_contact_phone = models.CharField(max_length=32, blank=True)
    emergency_contact_relation = models.CharField(max_length=60, blank=True)
    photo = models.ImageField(upload_to=RandomUploadPath("employee_photos"), blank=True)

    class Meta:
        ordering = ["employee_code"]
        indexes = [models.Index(fields=["employment_status"])]
        constraints = [
            models.CheckConstraint(condition=~models.Q(manager=models.F("id")), name="employee_not_own_manager"),
            models.CheckConstraint(
                condition=models.Q(exit_date__isnull=True) | models.Q(exit_date__gte=models.F("joining_date")),
                name="employee_exit_after_joining",
            ),
        ]

    def __str__(self):
        return f"{self.employee_code} {self.user.full_name}"

    @property
    def photo_version(self):
        """Changes with every new photo (stored under a new random name): lets browsers cache an
        avatar privately and still show a replacement immediately (?v=<version>)."""
        if not self.photo:
            return None
        return hashlib.sha256(self.photo.name.encode()).hexdigest()[:12]

    @property
    def full_name(self):
        return self.user.full_name

    @property
    def is_current(self):
        return self.employment_status != self.Status.EXITED
