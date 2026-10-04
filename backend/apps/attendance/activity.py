"""Activity heartbeat, geofence monitoring and server-side reconciliation.

Privacy: the browser only reports *how many seconds ago* the user last interacted (and, in
office mode, its location). No keystrokes, typed text, screenshots or page contents are ever
collected. The server keeps one timestamp per work session (`last_activity_at`) and only
moves it forward.

Rules (server-authoritative; the client only reports):

* Inactivity: when an open work session has no activity for
  CompanySettings.inactivity_timeout_minutes (owner policy: 30), it is checked out with
  reason INACTIVITY_TIMEOUT at last activity + timeout. During a break the clock is paused
  until the day's break allowance runs out. An active overtime session is stopped the same
  way (AUTO_STOPPED, OVERTIME_INACTIVITY_TIMEOUT).
* Geofence exit: an office session is checked out with reason GEO_FENCE_EXIT when a precise
  reading shows the employee has clearly left the workplace radius (see geo.has_clearly_left).
  Not checked during breaks or for work-from-home sessions. A missing/denied location is
  recorded as a monitoring problem and never treated as "left the workplace".
* Reconciliation runs on every heartbeat / work-session read for that employee and for
  everyone via `manage.py reconcile_attendance` (schedule it every few minutes), so the rules
  still apply when the browser was closed or lost its connection.

Limits that no browser can overcome (documented for admins): nothing runs while the browser
is closed, background tabs may be throttled, the activity signal only covers the HRMS tab
(or, with the browser's Idle Detection permission, the whole device), and a determined user
can spoof browser location. The server therefore treats missing heartbeats as inactivity
rather than assuming the employee was working.
"""

import datetime

from django.db import transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.employees.models import Employee
from apps.organization.models import CompanySettings

from . import geo
from .models import AttendanceRecord, BreakSession, OvertimeSession, OvertimeStatus, SessionStatus
from .services import auto_checkout
from .sessions import _employee, allowance_end, auto_stop_overtime, close_break

LOCATION_STATUSES = ("ok", "denied", "unavailable", "timeout", "unsupported", "not_requested")


def _timeout(cs):
    m = cs.inactivity_timeout_minutes
    return datetime.timedelta(minutes=m) if m else None


def _open_record(employee, lock=True):
    qs = AttendanceRecord.objects.filter(employee=employee, check_in__isnull=False, check_out__isnull=True)
    if lock:
        qs = qs.select_for_update()
    return qs.order_by("-date").first()


def inactivity_deadline(record, cs, active_break=None):
    """When the open session will be checked out for inactivity (None = never)."""
    timeout = _timeout(cs)
    if timeout is None or record.check_out is not None or record.check_in is None or record.last_activity_at is None:
        return None
    base = record.last_activity_at
    last_break = (
        BreakSession.objects.filter(attendance=record, status=SessionStatus.COMPLETED).order_by("-ended_at").first()
    )
    if last_break is not None and last_break.ended_at > base:
        base = last_break.ended_at  # being on a break is not inactivity
    if active_break is not None:
        end = allowance_end(active_break, record, cs)
        if end is None:
            return None  # unlimited breaks: no inactivity rule while on a break
        base = max(base, end)
    return base + timeout


@transaction.atomic
def reconcile_employee(employee, now=None, cs=None, request=None):
    """Apply the time-based rules for one employee. Idempotent; returns what happened."""
    cs = cs or CompanySettings.get_solo()
    now = now or timezone.now()
    done = {"break_ended": False, "checked_out": False, "overtime_stopped": False}
    record = _open_record(employee)
    if record is not None:
        active_break = (
            BreakSession.objects.select_for_update().filter(attendance=record, status=SessionStatus.ACTIVE).first()
        )
        if active_break is not None:
            end = allowance_end(active_break, record, cs)
            if end is not None and now >= end:
                record = close_break(active_break, end, cs, reason=BreakSession.EndReason.ALLOWANCE_EXHAUSTED)
                audit.record(
                    request,
                    "ATTENDANCE_BREAK_ENDED",
                    obj=active_break,
                    metadata={"reason": active_break.end_reason, "duration_seconds": active_break.duration_seconds},
                    actor=None,
                )
                active_break, done["break_ended"] = None, True
        deadline = inactivity_deadline(record, cs, active_break)
        if deadline is not None and now >= deadline:
            done["checked_out"] = auto_checkout(
                record, deadline, AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT, request=request, cs=cs
            )

    timeout = _timeout(cs)
    if timeout is not None:
        session = (
            OvertimeSession.objects.select_for_update()
            .filter(employee=employee, status=OvertimeStatus.ACTIVE, last_activity_at__isnull=False)
            .first()
        )
        if session is not None and now >= session.last_activity_at + timeout:
            done["overtime_stopped"] = auto_stop_overtime(session, session.last_activity_at + timeout, cs, request)
    return done


def reconcile_all(now=None):
    """Scheduled reconciliation for everyone with an open session, break or overtime."""
    cs = CompanySettings.get_solo()
    now = now or timezone.now()
    ids = set(
        AttendanceRecord.objects.filter(
            check_in__isnull=False, check_out__isnull=True, last_activity_at__isnull=False
        ).values_list("employee_id", flat=True)
    )
    ids |= set(
        OvertimeSession.objects.filter(status=OvertimeStatus.ACTIVE).values_list("employee_id", flat=True)
    )
    totals = {"employees": 0, "break_ended": 0, "checked_out": 0, "overtime_stopped": 0}
    for employee in Employee.objects.filter(pk__in=ids).select_related("user"):
        result = reconcile_employee(employee, now=now, cs=cs)
        totals["employees"] += 1
        for key, value in result.items():
            totals[key] += int(bool(value))
    return totals


def _note_location_issue(request, record, issue, now):
    """Record a monitoring problem once per change (no audit spam on every heartbeat)."""
    if record.location_issue == issue:
        return
    record.location_issue = issue
    record.location_issue_at = now if issue else None
    record.save(update_fields=["location_issue", "location_issue_at", "updated_at"])
    if issue:
        audit.record(request, "ATTENDANCE_LOCATION_UNAVAILABLE", obj=record, metadata={"issue": issue})


@transaction.atomic
def heartbeat(request, *, idle_seconds, location_status="not_requested", latitude=None, longitude=None, accuracy=None):
    """One activity/location report from the employee's browser. Returns True when the
    work session or overtime changed state because of it."""
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    now = timezone.now()
    record = _open_record(employee)
    changed = False
    if record is not None:
        on_break = BreakSession.objects.filter(attendance=record, status=SessionStatus.ACTIVE).exists()
        if not on_break:
            # The client says when the user last interacted; the server clamps it to the
            # session and only ever moves the timestamp forward.
            candidate = max(now - datetime.timedelta(seconds=idle_seconds), record.check_in)
            if record.last_activity_at is None or candidate > record.last_activity_at:
                record.last_activity_at = candidate
                record.save(update_fields=["last_activity_at", "updated_at"])
            if record.mode == AttendanceRecord.Mode.OFFICE and cs.geofence_configured:
                changed |= _check_geofence(request, record, cs, now, location_status, latitude, longitude, accuracy)

    session = (
        OvertimeSession.objects.select_for_update().filter(employee=employee, status=OvertimeStatus.ACTIVE).first()
    )
    if session is not None:
        candidate = max(now - datetime.timedelta(seconds=idle_seconds), session.started_at)
        if session.last_activity_at is None or candidate > session.last_activity_at:
            session.last_activity_at = candidate
            session.save(update_fields=["last_activity_at", "updated_at"])

    result = reconcile_employee(employee, now=now, cs=cs, request=request)
    return changed or any(result.values())


def _check_geofence(request, record, cs, now, location_status, latitude, longitude, accuracy):
    if location_status != "ok" or latitude is None or longitude is None:
        if location_status in ("denied", "unavailable", "timeout", "unsupported"):
            _note_location_issue(request, record, location_status.upper(), now)
        return False
    if accuracy is None or accuracy > cs.geofence_max_accuracy_m:
        _note_location_issue(request, record, "LOW_ACCURACY", now)
        return False
    _note_location_issue(request, record, "", now)
    distance = geo.haversine_m(latitude, longitude, cs.workplace_latitude, cs.workplace_longitude)
    if geo.has_clearly_left(distance, accuracy, cs.geofence_radius_m):
        return auto_checkout(
            record,
            now,
            AttendanceRecord.CheckoutReason.GEO_FENCE_EXIT,
            request=request,
            latitude=latitude,
            longitude=longitude,
            distance=distance,
            cs=cs,
        )
    return False
