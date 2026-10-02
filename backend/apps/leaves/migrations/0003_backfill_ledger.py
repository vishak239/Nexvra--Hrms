from decimal import Decimal

from django.db import migrations


def forwards(apps, schema_editor):
    """Record one DEDUCTION for every request approved before the ledger existed, so the
    used balance (now the sum of deductions) is unchanged by the upgrade."""
    LeaveRequest = apps.get_model("leaves", "LeaveRequest")
    LeaveBalance = apps.get_model("leaves", "LeaveBalance")
    Txn = apps.get_model("leaves", "LeaveBalanceTransaction")
    approved = (
        LeaveRequest.objects.filter(status="APPROVED", leave_type__annual_allocation__isnull=False)
        .exclude(pk__in=Txn.objects.values("leave_request_id"))
        .order_by("decided_at", "pk")
    )
    for leave in approved:
        balance = LeaveBalance.objects.filter(
            employee_id=leave.employee_id, leave_type_id=leave.leave_type_id, year=leave.leave_year
        ).first()
        if balance is None:
            continue
        used = sum((t.days for t in Txn.objects.filter(balance=balance)), Decimal("0"))
        before = balance.allocated - used
        Txn.objects.create(
            balance=balance,
            leave_request=leave,
            kind="DEDUCTION",
            days=leave.days,
            balance_before=before,
            balance_after=max(Decimal("0"), before - leave.days),
            created_by_id=leave.decided_by_id,
        )


class Migration(migrations.Migration):
    dependencies = [("leaves", "0002_balance_ledger")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
