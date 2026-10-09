"""Activity heartbeat, geofence monitoring and server-side reconciliation.

Privacy: the browser only reports *when* the user interacted (as "seconds ago" offsets) and,
in office mode, its location. No keystrokes, typed text, screenshots or page contents are ever
collected. The server keeps one timestamp per work session (`last_activity_at`) and only moves
it forward.

Rules (server-authoritative; the client only reports):

* Inactivity: when an open work session has no activity for
  CompanySettings.inactivity_timeout_minutes (owner policy: 30), it is checked out with reason
  INACTIVITY_TIMEOUT at last activity + timeout. Breaks (until the day's allowance runs out) and
  meeting pauses stop the clock, and it restarts when they end. An active overtime session is
  stopped the same way (AUTO_STOPPED, OVERTIME_INACTIVITY_TIMEOUT).
* Evidence before an inactivity check-out. A missing heartbeat alone is not inactivity: the
  network may be down while the employee works. The check-out happens when
    - a heartbeat that arrives after the deadline shows no activity before it (the browser was
      watching, or no browser was open at all), or
    - the browser has been completely silent for SILENT_GRACE beyond the deadline (closed
      laptop, closed browser), so a reconnecting browser has had time to report activity it saw
      while offline.
  Either way the check-out time is the deadline itself, never later.
* Activity seen while offline counts. Current browsers send `activity` (offsets of real
  interactions since their last acknowledged report) and `observed_seconds` (how long the page
  has been watching). The server walks the timeline from its last known activity: a gap of the
  full timeout between two activity moments (pauses excluded) is an inactivity check-out at the
  start of the gap + timeout; otherwise the latest moment becomes the new last activity. Time
  before the page started watching is unobserved, so reopening the browser later cannot
  back-fill activity for a period when it was closed.
* Geofence exit: an office session is checked out with reason GEO_FENCE_EXIT when a precise
  reading shows the employee has clearly left the workplace radius (see geo.has_clearly_left).
  Not checked during breaks, meetings or work-from-home sessions. A missing/denied location is
  recorded as a monitoring problem and never treated as "left the workplace".
* Reconciliation runs on every heartbeat / work-session read for that employee and for everyone
  via `manage.py reconcile_attendance` (scheduled every few minutes), so the rules still apply
  when the browser was closed or lost its connection. It also ends meetings at their planned end.

Limits no web page can overcome (documented for admins): nothing runs while the browser is
closed or the computer sleeps; the page only sees interaction with itself unless the employee
allows the browser's Idle Detection (Chrome / Edge), which reports a plain active / idle state
for the whole device; a determined user can spoof browser signals and location.
"""

import datetime

from django.db import transaction
from django.utils import timezone

from apps.audit import services as audit
from apps.core.timefmt import fmt_time
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from . import geo
from .meetings import settle_meetings
from .models import AttendanceRecord, BreakSession, MeetingPause, OvertimeSession, OvertimeStatus, SessionStatus
from .services import auto_checkout
from .sessions import _employee, allowance_end, auto_stop_overtime, close_break

LOCATION_STATUSES = ("ok", "denied", "unavailable", "timeout", "unsupported", "not_requested")

# How long the server waits for a silent browser after the inactivity deadline before deciding
# from the evidence it has (the check-out time is still the deadline itself).
SILENT_GRACE = datetime.timedelta(minutes=30)
# Tolerance for offsets that land just before the page started watching (rounding, latency).
OBSERVATION_SLACK = datetime.timedelta(seconds=5)


def _timeout(cs):
    m = cs.inactivity_timeout_minutes
    return datetime.timedelta(minutes=m) if m else None


def _open_record(employee, lock=True):
    qs = AttendanceRecord.objects.filter(employee=employee, check_in__isnull=False, check_out__isnull=True)
    if lock:
        qs = qs.select_for_update()
    return qs.order_by("-date").first()


def _pauses(record, cs):
    """Intervals in which inactivity does not accrue: breaks (a running break only until the
    allowance runs out) and meeting pauses. End None = still paused."""
    items = []
    for b in BreakSession.objects.filter(attendance=record):
        if b.status == SessionStatus.COMPLETED:
            items.append((b.started_at, b.ended_at))
        else:
            items.append((b.started_at, allowance_end(b, record, cs)))  # None: unlimited breaks
    for p in MeetingPause.objects.filter(attendance=record):
        items.append((p.started_at, p.ended_at))
    return items


def inactivity_deadline(record, cs, active_break=None, points=()):
    """When the open session is (or was) checked out for inactivity; None = not while paused /
    no rule. `points` are extra activity moments (from a heartbeat) after last_activity_at."""
    timeout = _timeout(cs)
    if timeout is None or record.check_out is not None or record.check_in is None or record.last_activity_at is None:
        return None
    cursor = record.last_activity_at
    events = [(p, p, False) for p in points if p > cursor]
    events += [(start, end, True) for start, end in _pauses(record, cs) if end is None or end > cursor]
    events.sort(key=lambda e: (e[0], e[2]))
    for start, end, is_pause in events:
        if start - cursor >= timeout:
            return cursor + timeout  # a full timeout passed before this event
        if is_pause and end is None:
            return None  # paused right now (break with no allowance, or a meeting)
        cursor = max(cursor, end)
    return cursor + timeout


def _has_evidence(record, deadline, now):
    """True when the server may act on an inactivity deadline that has passed."""
    if record.last_heartbeat_at is not None and record.last_heartbeat_at >= deadline:
        return True
    return now >= deadline + SILENT_GRACE


def _in_meeting(employee):
    return MeetingPause.objects.filter(employee=employee, status=SessionStatus.ACTIVE).exists()


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
                notify(
                    [employee.user],
                    Notification.Type.BREAK_AUTO_ENDED,
                    "Your break ended automatically",
                    f"Your {cs.break_allowance_minutes}-minute daily break allowance was used up at "
                    f"{fmt_time(end, cs.tz)}. Working time continues.",
                    obj=record,
                )
                done["break_ended"] = True
        deadline = inactivity_deadline(record, cs)
        if deadline is not None and now >= deadline and _has_evidence(record, deadline, now):
            done["checked_out"] = auto_checkout(
                record, deadline, AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT, request=request, cs=cs
            )

    timeout = _timeout(cs)
    if timeout is not None and not _in_meeting(employee):
        session = (
            OvertimeSession.objects.select_for_update()
            .filter(employee=employee, status=OvertimeStatus.ACTIVE, last_activity_at__isnull=False)
            .first()
        )
        if session is not None and now >= session.last_activity_at + timeout:
            done["overtime_stopped"] = auto_stop_overtime(session, session.last_activity_at + timeout, cs, request)
    return done


def reconcile_all(now=None):
    """Scheduled reconciliation: meetings past their planned end, then everyone with an open
    session, break or overtime."""
    cs = CompanySettings.get_solo()
    now = now or timezone.now()
    meetings_ended = settle_meetings(now)
    ids = set(
        AttendanceRecord.objects.filter(
            check_in__isnull=False, check_out__isnull=True, last_activity_at__isnull=False
        ).values_list("employee_id", flat=True)
    )
    ids |= set(
        OvertimeSession.objects.filter(status=OvertimeStatus.ACTIVE).values_list("employee_id", flat=True)
    )
    totals = {"employees": 0, "break_ended": 0, "checked_out": 0, "overtime_stopped": 0,
              "meetings_ended": meetings_ended}
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


def activity_points(now, floor, idle_seconds, activity=None, observed_seconds=None):
    """Activity moments reported by the browser, as server times, never before `floor` (the
    check-in) or the moment the page started watching, never in the future."""
    if activity is None:
        # Older clients only say how long ago the last interaction was.
        return [max(now - datetime.timedelta(seconds=idle_seconds), floor)]
    if observed_seconds is not None:
        floor = max(floor, now - datetime.timedelta(seconds=observed_seconds) - OBSERVATION_SLACK)
    return sorted({p for p in (now - datetime.timedelta(seconds=s) for s in activity) if p >= floor})


@transaction.atomic
def heartbeat(
    request,
    *,
    idle_seconds,
    activity=None,
    observed_seconds=None,
    location_status="not_requested",
    latitude=None,
    longitude=None,
    accuracy=None,
):
    """One activity/location report from the employee's browser. Returns True when the work
    session or overtime changed state because of it."""
    cs = CompanySettings.get_solo()
    settle_meetings()
    employee = _employee(request.user, cs, lock=True)
    now = timezone.now()
    record = _open_record(employee)
    changed = False
    if record is not None:
        record.last_heartbeat_at = now
        record.save(update_fields=["last_heartbeat_at", "updated_at"])
        on_break = BreakSession.objects.filter(attendance=record, status=SessionStatus.ACTIVE).exists()
        in_meeting = MeetingPause.objects.filter(attendance=record, status=SessionStatus.ACTIVE).exists()
        points = activity_points(now, record.check_in, idle_seconds, activity, observed_seconds)
        if activity is not None:
            # Walk the reported timeline: activity seen while offline counts; a full timeout
            # with no activity (or not watched at all) is an inactivity check-out.
            deadline = inactivity_deadline(record, cs, points=points)
            if deadline is not None and deadline <= now:
                changed |= auto_checkout(
                    record, deadline, AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT, request=request, cs=cs
                )
                record = None  # the session is closed; nothing else applies to it
    if record is not None:
        if points and not on_break:
            latest = points[-1]
            if record.last_activity_at is None or latest > record.last_activity_at:
                record.last_activity_at = latest
                record.save(update_fields=["last_activity_at", "updated_at"])
        if not on_break and not in_meeting and record.mode == AttendanceRecord.Mode.OFFICE and cs.geofence_configured:
            changed |= _check_geofence(request, record, cs, now, location_status, latitude, longitude, accuracy)

    session = (
        OvertimeSession.objects.select_for_update().filter(employee=employee, status=OvertimeStatus.ACTIVE).first()
    )
    if session is not None:
        points = activity_points(now, session.started_at, idle_seconds, activity, observed_seconds)
        if points and (session.last_activity_at is None or points[-1] > session.last_activity_at):
            session.last_activity_at = points[-1]
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
