"""Attendance rules. Every threshold comes from CompanySettings; when a threshold is not
configured, the dependent rule is simply not applied (no invented policy)."""

import datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.core.permissions import scope_queryset
from apps.employees.models import Employee
from apps.leaves.models import LeaveRequest
from apps.organization.models import CompanySettings, Holiday
from apps.tasks.rules import assert_checkout_allowed

from .models import AttendanceRecord
from .sessions import close_open_break_at_checkout

# Derived (not stored) day statuses used by the daily view and reports.
ON_LEAVE = "ON_LEAVE"
HOLIDAY = "HOLIDAY"
WEEKLY_OFF = "WEEKLY_OFF"
NOT_MARKED = "NOT_MARKED"
ABSENT = AttendanceRecord.Status.ABSENT


def company_today(cs=None):
    return (cs or CompanySettings.get_solo()).today()


def evaluate(record, cs):
    """Return (status, is_late) for a record using only configured thresholds."""
    is_late = False
    if record.check_in and cs.work_start_time is not None and cs.late_grace_minutes is not None:
        start = datetime.datetime.combine(record.date, cs.work_start_time, tzinfo=cs.tz)
        is_late = timezone.localtime(record.check_in, cs.tz) > start + datetime.timedelta(
            minutes=cs.late_grace_minutes
        )

    status = AttendanceRecord.Status.PRESENT
    minutes = record.worked_minutes
    if minutes is not None and cs.half_day_min_hours is not None and cs.full_day_min_hours is not None:
        hours = Decimal(minutes) / 60
        if hours >= cs.full_day_min_hours:
            status = AttendanceRecord.Status.PRESENT
        elif hours >= cs.half_day_min_hours:
            status = AttendanceRecord.Status.HALF_DAY
        else:
            status = AttendanceRecord.Status.ABSENT
    return status, is_late


def _self_employee(user, cs):
    if not cs.self_attendance_enabled:
        raise PermissionDenied("Self check-in is disabled by company settings.")
    employee = Employee.objects.filter(user=user).first()
    if employee is None or not employee.is_current:
        raise PermissionDenied("No active employee record for this account.")
    return employee


@transaction.atomic
def check_in(request):
    cs = CompanySettings.get_solo()
    employee = _self_employee(request.user, cs)
    now = timezone.now()
    today = timezone.localtime(now, cs.tz).date()
    record = AttendanceRecord.objects.select_for_update().filter(employee=employee, date=today).first()
    if record is not None and record.check_in is not None:
        raise Conflict("You have already checked in today.")
    if record is None:
        record = AttendanceRecord(employee=employee, date=today, source=AttendanceRecord.Source.SELF)
    record.check_in = now
    record.status, record.is_late = evaluate(record, cs)
    try:
        with transaction.atomic():
            record.save()
    except IntegrityError:
        raise Conflict("You have already checked in today.") from None
    audit.record(request, "ATTENDANCE_CHECK_IN", obj=record)
    return record


@transaction.atomic
def check_out(request):
    cs = CompanySettings.get_solo()
    employee = _self_employee(request.user, cs)
    now = timezone.now()
    today = timezone.localtime(now, cs.tz).date()
    record = AttendanceRecord.objects.select_for_update().filter(employee=employee, date=today).first()
    if record is None or record.check_in is None:
        raise Conflict("You have not checked in today.")
    if record.check_out is not None:
        raise Conflict("You have already checked out today.")
    # Task checkout protection (HR / Manager / Employee; Super Admin exempt). See apps/tasks/rules.py.
    assert_checkout_allowed(request.user)
    # An open break ends at check-out; break time is excluded from worked time.
    record = close_open_break_at_checkout(record, now)
    record.check_out = now
    record.status, record.is_late = evaluate(record, cs)
    record.save()
    audit.record(request, "ATTENDANCE_CHECK_OUT", obj=record)
    return record


def assert_can_manage_record_for(actor, employee):
    if employee.user_id == actor.pk and not actor.is_super_admin:
        raise PermissionDenied("You cannot correct your own attendance.")
    in_scope = scope_queryset(Employee.objects.filter(pk=employee.pk), actor, "attendance", employee_path="")
    if not in_scope.exists():
        raise PermissionDenied("This employee is outside your scope.")


AUDIT_FIELDS = ["employee_id", "date", "check_in", "check_out", "status", "is_late", "remarks"]


@transaction.atomic
def admin_save(request, data, record=None):
    """Create or correct a record on behalf of an employee (HR). If no explicit status is
    given, it is computed from the configured rules."""
    cs = CompanySettings.get_solo()
    employee = data.get("employee", record.employee if record else None)
    assert_can_manage_record_for(request.user, employee)
    explicit_status = data.pop("status", None)
    before = audit.snapshot(record, AUDIT_FIELDS) if record else {}
    record = record or AttendanceRecord()
    for field, value in data.items():
        setattr(record, field, value)
    record.status, record.is_late = evaluate(record, cs)
    if explicit_status:
        record.status = explicit_status
    record.source = AttendanceRecord.Source.ADMIN
    record.updated_by = request.user
    record.save()
    action = "ATTENDANCE_CORRECTED" if before else "ATTENDANCE_RECORDED"
    audit.record(request, action, obj=record, changes=audit.diff(before, audit.snapshot(record, AUDIT_FIELDS)))
    return record


def classify(day, record, on_leave, is_holiday, cs, today):
    """Single source of truth for a day's status (stored record first, then derived)."""
    if record is not None:
        return record.status
    if on_leave:
        return ON_LEAVE
    if is_holiday:
        return HOLIDAY
    if cs.working_days and not cs.is_working_day(day):
        return WEEKLY_OFF
    if cs.working_days and day < today:
        return ABSENT
    return NOT_MARKED


def employed_on(employee, day):
    return employee.joining_date <= day and (employee.exit_date is None or employee.exit_date >= day)


def daily_status(employees, day, cs=None):
    """Status per employee for one date. Returns a list of dicts."""
    cs = cs or CompanySettings.get_solo()
    employees = [e for e in employees if employed_on(e, day)]
    ids = [e.id for e in employees]
    records = {r.employee_id: r for r in AttendanceRecord.objects.filter(employee_id__in=ids, date=day)}
    on_leave = set(
        LeaveRequest.objects.filter(
            employee_id__in=ids,
            status=LeaveRequest.Status.APPROVED,
            start_date__lte=day,
            end_date__gte=day,
        ).values_list("employee_id", flat=True)
    )
    is_holiday = Holiday.objects.filter(date=day, is_optional=False).exists()
    today = company_today(cs)
    return [
        {
            "employee": emp,
            "record": records.get(emp.id),
            "status": classify(day, records.get(emp.id), emp.id in on_leave, is_holiday, cs, today),
        }
        for emp in employees
    ]
