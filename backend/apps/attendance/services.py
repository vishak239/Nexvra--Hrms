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
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings, Holiday
from apps.tasks.rules import assert_checkout_allowed

from . import geo
from .errors import (
    LocationRequired,
    LocationTooImprecise,
    OutsideGeofence,
    ResumePending,
    ResumeRequired,
    WfhNotApproved,
)
from .meetings import close_open_pause_at_checkout
from .models import AttendanceRecord, NonWorkingPeriod, OvertimeSession, OvertimeStatus, ResumeWorkRequest
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


def office_location_check(cs, latitude, longitude, accuracy):
    """Server-side geofence for an office check-in. Returns the distance in metres (or None
    when no workplace is configured, i.e. the rule is not applied). Raises when not allowed.
    The client's own distance / "inside" flags are never consulted."""
    if not cs.geofence_configured:
        return None
    if latitude is None or longitude is None:
        raise LocationRequired()
    if accuracy is None or accuracy > cs.geofence_max_accuracy_m:
        raise LocationTooImprecise(
            f"Your location is not precise enough to check in (needs ±{cs.geofence_max_accuracy_m} m or better)."
        )
    distance = geo.haversine_m(latitude, longitude, cs.workplace_latitude, cs.workplace_longitude)
    if not geo.within_radius(distance, cs.geofence_radius_m):
        raise OutsideGeofence(
            f"You are outside the workplace check-in area (about {round(distance)} m away; "
            f"check-in is allowed within {cs.geofence_radius_m} m)."
        )
    return distance


def _coord(value):
    return None if value is None else Decimal(str(round(float(value), 6)))


def _approved_resume(record):
    """The approved Resume Work request that allows checking in again after an automatic
    inactivity check-out. Without one, a checked-out day stays checked out."""
    if record.check_out is None:
        raise Conflict("You have already checked in today.")
    if record.checkout_reason != AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT:
        raise Conflict("You have already checked in today.")
    resume = (
        ResumeWorkRequest.objects.select_for_update()
        .filter(attendance=record, status__in=ResumeWorkRequest.OPEN)
        .first()
    )
    if resume is None:
        raise ResumeRequired()
    if resume.status == ResumeWorkRequest.Status.PENDING:
        raise ResumePending()
    if OvertimeSession.objects.filter(employee=record.employee, status=OvertimeStatus.ACTIVE).exists():
        raise Conflict("Stop your overtime before resuming normal work.")
    return resume


@transaction.atomic
def check_in(request, mode=AttendanceRecord.Mode.OFFICE, latitude=None, longitude=None, accuracy=None):
    """Office check-in needs to pass the server-side geofence (when a workplace is configured).
    Work-from-home check-in needs an APPROVED request for today; no location is collected.

    After an automatic inactivity check-out the same day, checking in again needs an approved
    Resume Work request and still passes the same geofence / work-from-home validation. It
    reopens the day's session: the gap becomes non-working time and a new working segment starts."""
    from .meetings import pause_if_in_meeting

    cs = CompanySettings.get_solo()
    employee = _self_employee(request.user, cs)
    now = timezone.now()
    today = timezone.localtime(now, cs.tz).date()
    record = AttendanceRecord.objects.select_for_update().filter(employee=employee, date=today).first()
    resume = None
    if record is not None and record.check_in is not None:
        resume = _approved_resume(record)

    wfh = None
    distance = None
    if mode == AttendanceRecord.Mode.WORK_FROM_HOME:
        from .wfh import approved_request_for

        wfh = approved_request_for(employee, today)
        if wfh is None:
            raise WfhNotApproved()
    else:
        distance = office_location_check(cs, latitude, longitude, accuracy)

    if resume is not None:
        record = _resume(request, record, resume, now, mode, wfh, distance, cs)
        pause_if_in_meeting(record, now)
        return record

    if record is None:
        record = AttendanceRecord(employee=employee, date=today, source=AttendanceRecord.Source.SELF)
    record.check_in = now
    record.mode = mode
    record.wfh_request = wfh
    record.last_activity_at = now
    record.last_heartbeat_at = now
    if mode == AttendanceRecord.Mode.OFFICE and latitude is not None and longitude is not None:
        record.check_in_latitude, record.check_in_longitude = _coord(latitude), _coord(longitude)
        record.check_in_accuracy_m = None if accuracy is None else round(accuracy)
        record.check_in_distance_m = None if distance is None else round(distance)
    record.status, record.is_late = evaluate(record, cs)
    try:
        with transaction.atomic():
            record.save()
    except IntegrityError:
        raise Conflict("You have already checked in today.") from None
    audit.record(
        request,
        "ATTENDANCE_CHECK_IN",
        obj=record,
        metadata={"mode": mode, "distance_m": record.check_in_distance_m, "wfh_request": getattr(wfh, "pk", None)},
    )
    pause_if_in_meeting(record, now)
    return record


def _resume(request, record, resume, now, mode, wfh, distance, cs):
    """Reopen the day's session after an approved Resume Work request (validation passed)."""
    period = NonWorkingPeriod.objects.select_for_update().filter(attendance=record, ended_at__isnull=True).first()
    if period is None:  # defensive: the gap is non-working time either way
        period = NonWorkingPeriod(attendance=record, employee=record.employee, started_at=record.check_out)
    period.ended_at = max(now, period.started_at)
    period.duration_seconds = int((period.ended_at - period.started_at).total_seconds())
    period.resume_request = resume
    period.save()
    previous_checkout = record.check_out
    record.total_non_working_seconds += period.duration_seconds
    record.check_out = None
    record.checkout_reason = ""
    record.check_out_latitude = record.check_out_longitude = record.check_out_distance_m = None
    record.mode = mode
    record.wfh_request = wfh
    record.last_activity_at = now
    record.last_heartbeat_at = now
    record.status, _ = evaluate(record, cs)
    record.save()
    resume.status = ResumeWorkRequest.Status.USED
    resume.used_at = now
    resume.save(update_fields=["status", "used_at", "updated_at"])
    audit.record(
        request,
        "ATTENDANCE_RESUMED",
        obj=record,
        metadata={
            "mode": mode,
            "distance_m": None if distance is None else round(distance),
            "resume_request": resume.pk,
            "previous_check_out": previous_checkout,
            "non_working_seconds": period.duration_seconds,
        },
    )
    return record


@transaction.atomic
def check_out(request, latitude=None, longitude=None):
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
    # An open break / meeting pause ends at check-out; neither counts as worked time.
    record = close_open_break_at_checkout(record, now, cs)
    record = close_open_pause_at_checkout(record, now)
    record.check_out = now
    record.checkout_reason = AttendanceRecord.CheckoutReason.MANUAL
    if record.mode == AttendanceRecord.Mode.OFFICE and latitude is not None and longitude is not None:
        record.check_out_latitude, record.check_out_longitude = _coord(latitude), _coord(longitude)
        if cs.geofence_configured:
            record.check_out_distance_m = round(
                geo.haversine_m(latitude, longitude, cs.workplace_latitude, cs.workplace_longitude)
            )
    record.status, record.is_late = evaluate(record, cs)
    record.save()
    audit.record(request, "ATTENDANCE_CHECK_OUT", obj=record, metadata={"reason": record.checkout_reason})
    return record


def auto_checkout(record, at, reason, *, request=None, latitude=None, longitude=None, distance=None, cs=None):
    """System check-out (geofence exit or inactivity). Idempotent: a record that is already
    checked out is left untouched and False is returned. The caller holds a row lock.
    Task checkout protection does not apply: this is not the employee's own action."""
    if record.check_out is not None or record.check_in is None:
        return False
    cs = cs or CompanySettings.get_solo()
    at = max(at, record.check_in)
    record = close_open_break_at_checkout(record, at, cs)
    record = close_open_pause_at_checkout(record, at)
    record.check_out = at
    record.checkout_reason = reason
    if latitude is not None and longitude is not None:
        record.check_out_latitude, record.check_out_longitude = _coord(latitude), _coord(longitude)
    if distance is not None:
        record.check_out_distance_m = round(distance)
    record.status, record.is_late = evaluate(record, cs)
    record.save()
    if reason == AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT:
        # From here the employee is non-working until an approved Resume Work check-in.
        if not NonWorkingPeriod.objects.filter(attendance=record, ended_at__isnull=True).exists():
            NonWorkingPeriod.objects.create(attendance=record, employee=record.employee, started_at=at)
    audit.record(
        request,
        "ATTENDANCE_AUTO_CHECKOUT",
        obj=record,
        metadata={
            "reason": reason,
            "check_out": at,
            "last_activity_at": record.last_activity_at,
            "distance_m": record.check_out_distance_m,
        },
        actor=None,
    )
    why = {
        AttendanceRecord.CheckoutReason.GEO_FENCE_EXIT: "you left the workplace area",
        AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT: f"no activity for {cs.inactivity_timeout_minutes} minutes",
    }.get(reason, "an automatic rule")
    notify(
        [record.employee.user],
        Notification.Type.ATTENDANCE_AUTO_CHECKOUT,
        "You were checked out automatically",
        f"Checked out at {timezone.localtime(at, cs.tz):%H:%M} because {why}."
        + (
            " To continue working today, use Resume Work and give a reason; HR / Admin will review it."
            if reason == AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT
            else ""
        ),
        obj=record,
    )
    return True


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
    if "check_out" in data and data["check_out"] is not None:
        record.checkout_reason = AttendanceRecord.CheckoutReason.ADMIN
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
