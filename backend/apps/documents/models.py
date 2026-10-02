from django.conf import settings
from django.db import models

from apps.core.files import RandomUploadPath
from apps.core.models import TimeStampedModel


class EmployeeDocument(TimeStampedModel):
    class Category(models.TextChoices):
        OFFER_LETTER = "OFFER_LETTER", "Offer letter"
        APPOINTMENT_LETTER = "APPOINTMENT_LETTER", "Appointment letter"
        CERTIFICATE = "CERTIFICATE", "Certificate"
        ID_DOCUMENT = "ID_DOCUMENT", "ID document"
        PAYSLIP = "PAYSLIP", "Payslip"
        EXPERIENCE_LETTER = "EXPERIENCE_LETTER", "Experience letter"
        RELIEVING_LETTER = "RELIEVING_LETTER", "Relieving letter"
        OTHER = "OTHER", "Other"

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="documents")
    category = models.CharField(max_length=24, choices=Category.choices)
    title = models.CharField(max_length=200)
    file = models.FileField(upload_to=RandomUploadPath("documents"))
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    visible_to_employee = models.BooleanField(default=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["employee", "category"])]

    def __str__(self):
        return f"{self.employee_id} {self.title}"
