"""Leave rules. Only generic integrity rules are enforced (no overlaps, no self-approval,
balance not exceeded when the type tracks balances). Company-specific policies such as
sandwich rules, accrual or carry-forward are NOT SPECIFIED and therefore not applied.

State machine: PENDING -> APPROVED (locked) | REJECTED | CANCELLED. Only a PENDING request
can be cancelled, and only by its applicant; once APPROVED it is locked.

Balance accounting: the balance decreases ONLY when a request is approved, exactly once.
The approval writes one LeaveBalanceTransaction (one-to-one with the request) under row
locks on both the request and the balance. Pending, rejected and cancelled requests never
change the balance. Balances can never go negative (no negative-balance policy exists)."""

import datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.accounts.rbac import SUPER_ADMIN
from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings, Holiday

from .models import LeaveBalance, LeaveBalanceTransaction, LeaveRequest, LeaveType


def users_with_permission(code):
    return User.objects.filter(is_active=True).filter(
        Q(role__permissions__codename=code) | Q(role__code=SUPER_ADMIN)
    ).distinct()


def count_leave_days(start, end, is_half_day, cs):
    holidays = set(
        Holiday.objects.filter(date__range=(start, end), is_optional=False).values_list("date", flat=True)
    )
    days = 0
    day = start
    while day <= end:
        if cs.is_working_day(day) and day not in holidays:
            days += 1
        day += datetime.timedelta(days=1)
    if is_half_day:
        return Decimal("0.5") if days else Decimal("0")
    return Decimal(days)


def used_days(balance):
    if balance is None or balance.pk is None:
        return Decimal("0")
    return balance.transactions.aggregate(total=Sum("days"))["total"] or Decimal("0")


def balance_summary(employee, leave_type, year):
    """Allocated / used / pending / available for one employee, type and leave year.

    `available` is the balance itself (allocated - deducted on approval); it does NOT drop
    while a request is pending. `pending` shows days awaiting a decision and `requestable`
    is what can still be requested without over-committing the balance.
    Returns None for types that do not track balances."""
    if not leave_type.tracks_balance:
        return None
    balance = LeaveBalance.objects.filter(employee=employee, leave_type=leave_type, year=year).first()
    allocated = balance.allocated if balance else Decimal("0")
    used = used_days(balance)
    pending = (
        LeaveRequest.objects.filter(
            employee=employee, leave_type=leave_type, leave_year=year, status=LeaveRequest.Status.PENDING
        ).aggregate(total=Sum("days"))["total"]
        or Decimal("0")
    )
    available = allocated - used
    return {
        "has_allocation": balance is not None,
        "allocated": allocated,
        "used": used,
        "pending": pending,
        "available": available,
        "requestable": available - pending,
    }


def _assert_can_request(employee, leave_type, year, days):
    summary = balance_summary(employee, leave_type, year)
    if summary is None:
        return
    if not summary["has_allocation"]:
        raise ValidationError({"leave_type": ["No leave balance has been allocated for this leave type and year."]})
    if summary["requestable"] < days:
        pending = f", {summary['pending']} already requested in pending requests" if summary["pending"] else ""
        raise ValidationError(
            {
                "non_field_errors": [
                    f"Insufficient balance: {summary['available']} day(s) available{pending}, {days} requested."
                ]
            }
        )


def _deduct_on_approval(request, leave):
    """Write the single DEDUCTION for an approved request (caller holds the request lock)."""
    if not leave.leave_type.tracks_balance:
        return None
    balance = (
        LeaveBalance.objects.select_for_update()
        .filter(employee=leave.employee, leave_type=leave.leave_type, year=leave.leave_year)
        .first()
    )
    if balance is None:
        raise ValidationError({"leave_type": ["No leave balance has been allocated for this leave type and year."]})
    if LeaveBalanceTransaction.objects.filter(leave_request=leave).exists():
        return None  # already deducted; never deduct twice
    before = balance.allocated - used_days(balance)
    if before < leave.days:
        raise ValidationError(
            {
                "non_field_errors": [
                    f"Insufficient balance to approve: {before} day(s) available, {leave.days} requested."
                ]
            }
        )
    txn = LeaveBalanceTransaction.objects.create(
        balance=balance,
        leave_request=leave,
        days=leave.days,
        balance_before=before,
        balance_after=before - leave.days,
        created_by=request.user,
    )
    audit.record(
        request,
        "LEAVE_BALANCE_DEDUCTED",
        obj=leave,
        changes={"available": [before, txn.balance_after]},
        metadata={
            "days": leave.days,
            "balance": balance.pk,
            "leave_type": leave.leave_type.code,
            "year": leave.leave_year,
        },
    )
    return txn


@transaction.atomic
def submit(request, data):
    employee = Employee.objects.select_for_update().filter(user=request.user).first()
    if employee is None or not employee.is_current:
        raise PermissionDenied("No active employee record for this account.")
    cs = CompanySettings.get_solo()
    leave_type = data["leave_type"]
    start, end = data["start_date"], data["end_date"]
    is_half_day = data.get("is_half_day", False)

    if not leave_type.is_active:
        raise ValidationError({"leave_type": ["This leave type is not active."]})
    if is_half_day and not leave_type.allow_half_day:
        raise ValidationError({"is_half_day": ["Half-day leave is not allowed for this leave type."]})
    if start < employee.joining_date:
        raise ValidationError({"start_date": ["Leave cannot start before your joining date."]})
    leave_year = cs.leave_year_for(start)
    if cs.leave_year_for(end) != leave_year:
        raise ValidationError({"end_date": ["A request cannot span two leave years. Submit separate requests."]})
    overlap = LeaveRequest.objects.filter(
        employee=employee,
        status__in=LeaveRequest.ACTIVE_STATUSES,
        start_date__lte=end,
        end_date__gte=start,
    ).exists()
    if overlap:
        raise ValidationError({"non_field_errors": ["You already have a leave request overlapping these dates."]})
    days = count_leave_days(start, end, is_half_day, cs)
    if days <= 0:
        raise ValidationError({"non_field_errors": ["The selected dates contain no working days."]})
    _assert_can_request(employee, leave_type, leave_year, days)

    leave = LeaveRequest.objects.create(
        employee=employee,
        leave_type=leave_type,
        start_date=start,
        end_date=end,
        is_half_day=is_half_day,
        half_day_period=data.get("half_day_period", "") if is_half_day else "",
        days=days,
        leave_year=leave_year,
        reason=data.get("reason", ""),
    )
    approvers = [employee.manager.user] if employee.manager_id else users_with_permission("leave.approve_all")
    notify(
        [u for u in approvers if u.pk != request.user.pk],
        Notification.Type.LEAVE_SUBMITTED,
        f"Leave request from {employee.user.full_name}",
        f"{leave_type.name}: {start} to {end} ({days} day(s)).",
        obj=leave,
    )
    audit.record(request, "LEAVE_SUBMITTED", obj=leave, metadata={"days": days, "type": leave_type.code})
    return leave


def can_decide(actor, leave):
    if leave.employee.user_id == actor.pk:
        return False
    if actor.has_permission("leave.approve_all"):
        return True
    return (
        actor.has_permission("leave.approve_team")
        and leave.employee.manager_id is not None
        and leave.employee.manager.user_id == actor.pk
    )


def _lock(leave):
    related = ("employee__user", "employee__manager", "leave_type")
    return LeaveRequest.objects.select_for_update(of=("self",)).select_related(*related).get(pk=leave.pk)


@transaction.atomic
def decide(request, leave, approve, note=""):
    leave = _lock(leave)
    if not can_decide(request.user, leave):
        raise PermissionDenied("You cannot decide on this leave request.")
    if leave.status != LeaveRequest.Status.PENDING:
        raise Conflict("Only pending requests can be approved or rejected.")
    if approve:
        _deduct_on_approval(request, leave)
    leave.status = LeaveRequest.Status.APPROVED if approve else LeaveRequest.Status.REJECTED
    leave.decided_by = request.user
    leave.decided_at = timezone.now()
    leave.decision_note = note
    leave.save()
    word = "approved" if approve else "rejected"
    notify(
        [leave.employee.user],
        Notification.Type.LEAVE_APPROVED if approve else Notification.Type.LEAVE_REJECTED,
        f"Your leave request was {word}",
        f"{leave.leave_type.name}: {leave.start_date} to {leave.end_date}." + (f" Note: {note}" if note else ""),
        obj=leave,
    )
    audit.record(request, "LEAVE_APPROVED" if approve else "LEAVE_REJECTED", obj=leave, metadata={"note": note})
    return leave


@transaction.atomic
def cancel(request, leave):
    leave = _lock(leave)
    if leave.employee.user_id != request.user.pk:
        raise PermissionDenied("Only the employee who applied can cancel this request.")
    if leave.status == LeaveRequest.Status.APPROVED:
        raise Conflict("This leave has already been approved and cannot be cancelled.")
    if leave.status != LeaveRequest.Status.PENDING:
        raise Conflict("Only pending leave requests can be cancelled.")
    leave.status = LeaveRequest.Status.CANCELLED
    leave.cancelled_at = timezone.now()
    leave.save()
    # Nothing to restore: a pending request never reduced the balance.
    audit.record(request, "LEAVE_CANCELLED", obj=leave, changes={"status": ["PENDING", "CANCELLED"]})
    return leave


def assert_can_manage_balance_for(actor, employee):
    if employee.user_id == actor.pk and not actor.is_super_admin:
        raise PermissionDenied("You cannot change your own leave balance.")


@transaction.atomic
def allocate(request, leave_type, year, allocated, employees, overwrite=False):
    """Bulk-create (or optionally overwrite) balances for the given employees."""
    created = updated = skipped = 0
    for employee in employees:
        if employee.user_id == request.user.pk and not request.user.is_super_admin:
            skipped += 1
            continue
        balance = LeaveBalance.objects.select_for_update().filter(
            employee=employee, leave_type=leave_type, year=year
        ).first()
        if balance is None:
            LeaveBalance.objects.create(employee=employee, leave_type=leave_type, year=year, allocated=allocated)
            created += 1
        elif overwrite and balance.allocated != allocated and allocated >= used_days(balance):
            balance.allocated = allocated
            balance.save(update_fields=["allocated", "updated_at"])
            updated += 1
        else:
            skipped += 1
    audit.record(
        request,
        "LEAVE_BALANCES_ALLOCATED",
        obj=leave_type,
        metadata={
            "year": year,
            "allocated": allocated,
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "overwrite": overwrite,
        },
    )
    return {"created": created, "updated": updated, "skipped": skipped}


def active_types():
    return LeaveType.objects.filter(is_active=True)
