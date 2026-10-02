"""Payroll workflow: create run (DRAFT) -> generate payslips from salary structures ->
optional manual adjustments -> finalize (locks the run and publishes payslips).

Totals: gross = sum(earnings), deductions = sum(deductions), net = gross - deductions.
No statutory deductions, proration or loss-of-pay are applied (NOT SPECIFIED)."""

import calendar
import datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from .models import ComponentKind, PayrollRun, Payslip, PayslipItem, SalaryStructure


def period_bounds(year, month):
    return datetime.date(year, month, 1), datetime.date(year, month, calendar.monthrange(year, month)[1])


def assert_not_self(actor, employee, what="salary"):
    if employee.user_id == actor.pk and not actor.is_super_admin:
        raise PermissionDenied(f"You cannot change your own {what}.")


def assert_draft(run):
    if run.status != PayrollRun.Status.DRAFT:
        raise Conflict("This payroll run is finalized and can no longer be changed.")


def structure_for(employee, period_end):
    return (
        SalaryStructure.objects.filter(employee=employee, effective_from__lte=period_end)
        .prefetch_related("items__component")
        .order_by("-effective_from")
        .first()
    )


def recalculate(payslip):
    earnings = deductions = Decimal("0")
    for item in payslip.items.all():
        if item.kind == ComponentKind.EARNING:
            earnings += item.amount
        else:
            deductions += item.amount
    payslip.gross_earnings = earnings
    payslip.total_deductions = deductions
    payslip.net_pay = earnings - deductions
    payslip.save(update_fields=["gross_earnings", "total_deductions", "net_pay", "updated_at"])
    return payslip


@transaction.atomic
def save_structure(request, data, items, structure=None):
    employee = data.get("employee") or structure.employee
    assert_not_self(request.user, employee)
    before = None
    if structure is None:
        structure = SalaryStructure(**data)
    else:
        before = {i.component.code: str(i.amount) for i in structure.items.select_related("component")}
        for field, value in data.items():
            setattr(structure, field, value)
    try:
        with transaction.atomic():
            structure.save()
    except IntegrityError:
        raise ValidationError({"effective_from": ["A structure with this effective date already exists."]}) from None
    if items is not None:
        structure.items.all().delete()
        structure.items.bulk_create(
            [structure.items.model(structure=structure, component=i["component"], amount=i["amount"]) for i in items]
        )
    after = {i.component.code: str(i.amount) for i in structure.items.select_related("component")}
    audit.record(
        request,
        "SALARY_STRUCTURE_UPDATED" if before is not None else "SALARY_STRUCTURE_CREATED",
        obj=structure,
        changes={"employee": employee.pk, "effective_from": structure.effective_from, "items": [before, after]},
    )
    return structure


@transaction.atomic
def create_run(request, year, month):
    cs = CompanySettings.get_solo()
    try:
        with transaction.atomic():
            run = PayrollRun.objects.create(year=year, month=month, currency=cs.currency, created_by=request.user)
    except IntegrityError:
        raise Conflict("A payroll run already exists for this period.") from None
    audit.record(request, "PAYROLL_RUN_CREATED", obj=run, metadata={"period": f"{year}-{month:02d}"})
    return run


@transaction.atomic
def generate(request, run):
    run = PayrollRun.objects.select_for_update().get(pk=run.pk)
    assert_draft(run)
    start, end = period_bounds(run.year, run.month)
    employees = (
        Employee.objects.filter(joining_date__lte=end)
        .exclude(exit_date__lt=start)
        .exclude(payslips__run=run)
        .select_related("user")
    )
    created, missing_structure = 0, []
    for employee in employees:
        structure = structure_for(employee, end)
        if structure is None:
            missing_structure.append(employee.employee_code)
            continue
        payslip = Payslip.objects.create(run=run, employee=employee)
        PayslipItem.objects.bulk_create(
            [
                PayslipItem(
                    payslip=payslip,
                    name=item.component.name,
                    kind=item.component.kind,
                    amount=item.amount,
                    source=PayslipItem.Source.STRUCTURE,
                )
                for item in structure.items.all()
            ]
        )
        recalculate(payslip)
        created += 1
    audit.record(
        request,
        "PAYROLL_GENERATED",
        obj=run,
        metadata={"created": created, "missing_structure": missing_structure},
    )
    return {"created": created, "missing_structure": missing_structure}


@transaction.atomic
def add_adjustment(request, payslip, name, kind, amount):
    payslip = Payslip.objects.select_related("run", "employee").select_for_update(of=("self",)).get(pk=payslip.pk)
    assert_draft(payslip.run)
    assert_not_self(request.user, payslip.employee, "payslip")
    item = PayslipItem.objects.create(
        payslip=payslip, name=name, kind=kind, amount=amount, source=PayslipItem.Source.ADJUSTMENT
    )
    recalculate(payslip)
    meta = {"name": name, "kind": kind, "amount": amount}
    audit.record(request, "PAYSLIP_ADJUSTMENT_ADDED", obj=payslip, metadata=meta)
    return item


@transaction.atomic
def remove_adjustment(request, payslip, item_id):
    payslip = Payslip.objects.select_related("run", "employee").select_for_update(of=("self",)).get(pk=payslip.pk)
    assert_draft(payslip.run)
    assert_not_self(request.user, payslip.employee, "payslip")
    item = payslip.items.filter(pk=item_id, source=PayslipItem.Source.ADJUSTMENT).first()
    if item is None:
        raise ValidationError({"item": ["Adjustment not found on this payslip."]})
    meta = {"name": item.name, "kind": item.kind, "amount": item.amount}
    item.delete()
    recalculate(payslip)
    audit.record(request, "PAYSLIP_ADJUSTMENT_REMOVED", obj=payslip, metadata=meta)


@transaction.atomic
def delete_payslip(request, payslip):
    assert_draft(payslip.run)
    audit.record(request, "PAYSLIP_DELETED", obj=payslip, metadata={"employee": payslip.employee_id})
    payslip.delete()


@transaction.atomic
def finalize(request, run):
    run = PayrollRun.objects.select_for_update().get(pk=run.pk)
    assert_draft(run)
    payslips = list(run.payslips.select_related("employee__user"))
    if not payslips:
        raise ValidationError({"non_field_errors": ["Generate payslips before finalizing."]})
    run.status = PayrollRun.Status.FINALIZED
    run.finalized_by = request.user
    run.finalized_at = timezone.now()
    run.save()
    period = datetime.date(run.year, run.month, 1).strftime("%B %Y")
    for payslip in payslips:
        notify(
            [payslip.employee.user],
            Notification.Type.PAYSLIP_PUBLISHED,
            f"Payslip for {period} is available",
            obj=payslip,
        )
    audit.record(request, "PAYROLL_FINALIZED", obj=run, metadata={"payslips": len(payslips)})
    return run
