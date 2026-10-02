"""Basic, non-statutory payroll. No PF/ESI/TDS/PT, proration or loss-of-pay is applied
because none were specified (requirements-analysis.md §2.8)."""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import TimeStampedModel


class ComponentKind(models.TextChoices):
    EARNING = "EARNING", "Earning"
    DEDUCTION = "DEDUCTION", "Deduction"


class PayComponent(TimeStampedModel):
    name = models.CharField(max_length=80, unique=True)
    code = models.CharField(max_length=20, unique=True)
    kind = models.CharField(max_length=10, choices=ComponentKind.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "name"]

    def __str__(self):
        return self.name


class SalaryStructure(TimeStampedModel):
    """Monthly amounts per component, effective from a date. The latest structure whose
    effective_from is on/before the payroll period end applies."""

    employee = models.ForeignKey("employees.Employee", on_delete=models.CASCADE, related_name="salary_structures")
    effective_from = models.DateField()
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["employee_id", "-effective_from"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "effective_from"], name="salary_structure_unique_effective")
        ]

    def __str__(self):
        return f"{self.employee_id} from {self.effective_from}"


class SalaryStructureItem(models.Model):
    structure = models.ForeignKey(SalaryStructure, on_delete=models.CASCADE, related_name="items")
    component = models.ForeignKey(PayComponent, on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["structure", "component"], name="salary_item_unique_component"),
            models.CheckConstraint(condition=models.Q(amount__gte=0), name="salary_item_amount_non_negative"),
        ]

    def __str__(self):
        return f"{self.component_id}: {self.amount}"


class PayrollRun(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        FINALIZED = "FINALIZED", "Finalized"

    year = models.PositiveSmallIntegerField(validators=[MinValueValidator(2000), MaxValueValidator(2100)])
    month = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(12)])
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    currency = models.CharField(max_length=3, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    finalized_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-year", "-month"]
        constraints = [
            models.UniqueConstraint(fields=["year", "month"], name="payroll_run_unique_period"),
            models.CheckConstraint(condition=models.Q(month__gte=1, month__lte=12), name="payroll_run_valid_month"),
        ]

    def __str__(self):
        return f"{self.year}-{self.month:02d} {self.status}"

    @property
    def is_locked(self):
        return self.status == self.Status.FINALIZED


class Payslip(TimeStampedModel):
    """Totals are recomputed from items on every change while the run is DRAFT and then frozen."""

    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="payslips")
    employee = models.ForeignKey("employees.Employee", on_delete=models.PROTECT, related_name="payslips")
    gross_earnings = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_pay = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        ordering = ["-run__year", "-run__month", "employee__employee_code"]
        constraints = [models.UniqueConstraint(fields=["run", "employee"], name="payslip_unique_per_run")]

    def __str__(self):
        return f"{self.run} {self.employee_id}"


class PayslipItem(models.Model):
    class Source(models.TextChoices):
        STRUCTURE = "STRUCTURE", "Salary structure"
        ADJUSTMENT = "ADJUSTMENT", "Manual adjustment"

    payslip = models.ForeignKey(Payslip, on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=80, help_text="Snapshot of the component name.")
    kind = models.CharField(max_length=10, choices=ComponentKind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.STRUCTURE)

    class Meta:
        ordering = ["kind", "id"]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gte=0), name="payslip_item_non_negative")]

    def __str__(self):
        return f"{self.name}: {self.amount}"
