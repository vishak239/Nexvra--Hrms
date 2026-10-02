"""Leave rules. Only generic integrity rules are enforced (no overlaps, no self-approval,
balance not exceeded when the type tracks balances). Company-specific policies such as
sandwich rules, accrual or carry-forward are NOT SPECIFIED and therefore not applied."""

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

from .models import LeaveBalance, LeaveRequest, LeaveType


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


def balance_summary(employee, leave_type, year, exclude_request_id=None):
    """Allocated / used / pending / available for one employee, type and leave year.
    Returns None for types that do not track balances."""
    if not leave_type.tracks_balance:
        return None
    balance = LeaveBalance.objects.filter(employee=employee, leave_type=leave_type, year=year).first()
    allocated = balance.allocated if balance else Decimal("0")
    requests = LeaveRequest.objects.filter(employee=employee, leave_type=leave_type, leave_year=year)
    if exclude_request_id:
        requests = requests.exclude(pk=exclude_request_id)
    totals = {
        row["status"]: row["total"]
        for row in requests.filter(status__in=LeaveRequest.ACTIVE_STATUSES).values("status").annotate(total=Sum("days"))
    }
    used = totals.get(LeaveRequest.Status.APPROVED) or Decimal("0")
    pending = totals.get(LeaveRequest.Status.PENDING) or Decimal("0")
    return {
        "has_allocation": balance is not None,
        "allocated": allocated,
        "used": used,
        "pending": pending,
        "available": allocated - used - pending,
    }


def _assert_balance(employee, leave_type, year, days, exclude_request_id=None):
    summary = balance_summary(employee, leave_type, year, exclude_request_id)
    if summary is None:
        return
    if not summary["has_allocation"]:
        raise ValidationError({"leave_type": ["No leave balance has been allocated for this leave type and year."]})
    if summary["available"] < days:
        raise ValidationError(
            {"non_field_errors": [f"Insufficient balance: {summary['available']} day(s) available, {days} requested."]}
        )


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
    _assert_balance(employee, leave_type, leave_year, days)

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
        _assert_balance(leave.employee, leave.leave_type, leave.leave_year, leave.days, exclude_request_id=leave.pk)
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
    today = CompanySettings.get_solo().today()
    cancellable = leave.status == LeaveRequest.Status.PENDING or (
        leave.status == LeaveRequest.Status.APPROVED and leave.start_date > today
    )
    if not cancellable:
        raise Conflict("This request can no longer be cancelled.")
    was_approved = leave.status == LeaveRequest.Status.APPROVED
    leave.status = LeaveRequest.Status.CANCELLED
    leave.cancelled_at = timezone.now()
    leave.save()
    if was_approved and leave.decided_by_id:
        notify(
            [leave.decided_by],
            Notification.Type.LEAVE_CANCELLED,
            f"{leave.employee.user.full_name} cancelled approved leave",
            f"{leave.leave_type.name}: {leave.start_date} to {leave.end_date}.",
            obj=leave,
        )
    audit.record(request, "LEAVE_CANCELLED", obj=leave)
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
        balance = LeaveBalance.objects.filter(employee=employee, leave_type=leave_type, year=year).first()
        if balance is None:
            LeaveBalance.objects.create(employee=employee, leave_type=leave_type, year=year, allocated=allocated)
            created += 1
        elif overwrite and balance.allocated != allocated:
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
