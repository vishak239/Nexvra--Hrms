"""Work-session events: breaks and overtime, plus idempotent offline synchronisation.

Rules (all enforced here, on the server):

* A break needs today's check-in, no check-out yet, and no other active break. Breaks never
  overlap (a new break cannot start before the previous one ended). Several breaks per day
  are allowed. Ending a break adds its duration to AttendanceRecord.total_break_seconds,
  which is subtracted from worked time.
* Overtime starts only after the day's normal check-out, at most one runs at a time, and
  sessions never overlap. Its duration is kept separately and never added to worked time.
* Every event may carry a client UUID. (user, client_event_id) is unique, so retries and
  re-synchronised offline events are applied at most once.
* Offline events report when they happened on the device. That time is only accepted
  within OFFLINE_MAX_AGE in the past and OFFLINE_MAX_CLOCK_SKEW in the future, and must
  still be consistent with the server's state (e.g. not before check-in). The server's own
  receive time is stored as well.
"""

import datetime

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from .models import AttendanceRecord, BreakSession, OvertimeSession, SessionSource, SessionStatus, SyncEvent

OFFLINE_MAX_AGE = datetime.timedelta(hours=24)
OFFLINE_MAX_CLOCK_SKEW = datetime.timedelta(minutes=5)
MAX_EVENTS_PER_SYNC = 100


def _employee(user, cs, lock=False):
    if not cs.self_attendance_enabled:
        raise PermissionDenied("Self check-in is disabled by company settings.")
    qs = Employee.objects.select_related("user", "manager__user")
    if lock:
        qs = qs.select_for_update(of=("self",))
    employee = qs.filter(user=user).first()
    if employee is None or not employee.is_current:
        raise PermissionDenied("No active employee record for this account.")
    return employee


def assert_can_self_record(user):
    _employee(user, CompanySettings.get_solo())


def _day(at, cs):
    return timezone.localtime(at, cs.tz).date()


def _fmt(at, cs):
    return timezone.localtime(at, cs.tz).strftime("%H:%M")


def _seconds(start, end):
    return max(0, int((end - start).total_seconds()))


# --- breaks ----------------------------------------------------------------------------


@transaction.atomic
def start_break(request, at=None, source=SessionSource.ONLINE):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    at = at or timezone.now()
    record = AttendanceRecord.objects.select_for_update().filter(employee=employee, date=_day(at, cs)).first()
    if record is None or record.check_in is None:
        raise Conflict("Check in before starting a break.")
    if record.check_out is not None:
        raise Conflict("You have already checked out today.")
    if at < record.check_in:
        raise Conflict("A break cannot start before your check-in time.")
    if BreakSession.objects.filter(employee=employee, status=SessionStatus.ACTIVE).exists():
        raise Conflict("You are already on a break.")
    last = BreakSession.objects.filter(attendance=record, status=SessionStatus.COMPLETED).order_by("-ended_at").first()
    if last is not None and at < last.ended_at:
        raise Conflict(f"A break cannot overlap your previous break (ended {_fmt(last.ended_at, cs)}).")
    try:
        with transaction.atomic():
            session = BreakSession.objects.create(attendance=record, employee=employee, started_at=at, source=source)
    except IntegrityError:
        raise Conflict("You are already on a break.") from None
    audit.record(request, "ATTENDANCE_BREAK_STARTED", obj=session, metadata={"source": source})
    return session


def _close_break(session, at):
    session.ended_at = at
    session.duration_seconds = _seconds(session.started_at, at)
    session.status = SessionStatus.COMPLETED
    session.save(update_fields=["ended_at", "duration_seconds", "status", "updated_at"])
    record = AttendanceRecord.objects.select_for_update().get(pk=session.attendance_id)
    record.total_break_seconds += session.duration_seconds
    record.save(update_fields=["total_break_seconds", "updated_at"])
    return record


@transaction.atomic
def end_break(request, at=None, source=SessionSource.ONLINE):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    at = at or timezone.now()
    session = (
        BreakSession.objects.select_for_update()
        .filter(employee=employee, status=SessionStatus.ACTIVE)
        .select_related("attendance")
        .first()
    )
    if session is None:
        raise Conflict("You are not on a break.")
    if at < session.started_at:
        raise Conflict("A break cannot end before it started.")
    _close_break(session, at)
    audit.record(
        request,
        "ATTENDANCE_BREAK_ENDED",
        obj=session,
        metadata={"duration_seconds": session.duration_seconds, "source": source},
    )
    return session


def close_open_break_at_checkout(record, at):
    """Called by check-out: an open break ends at the check-out time."""
    session = BreakSession.objects.select_for_update().filter(attendance=record, status=SessionStatus.ACTIVE).first()
    if session is None:
        return record
    record = _close_break(session, max(at, session.started_at))
    return record


# --- overtime --------------------------------------------------------------------------


def _overtime_recipients(employee):
    return [employee.manager.user] if employee.manager_id else []


@transaction.atomic
def start_overtime(request, at=None, source=SessionSource.ONLINE):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    at = at or timezone.now()
    day = _day(at, cs)
    record = AttendanceRecord.objects.filter(employee=employee, date=day).first()
    if record is None or record.check_out is None:
        raise Conflict("Overtime starts after your normal check-out. Check out first.")
    if at < record.check_out:
        raise Conflict("Overtime cannot start before your normal check-out time.")
    if OvertimeSession.objects.filter(employee=employee, status=SessionStatus.ACTIVE).exists():
        raise Conflict("Overtime is already running.")
    last = (
        OvertimeSession.objects.filter(employee=employee, status=SessionStatus.COMPLETED)
        .order_by("-ended_at")
        .first()
    )
    if last is not None and at < last.ended_at:
        raise Conflict(f"Overtime cannot overlap your previous overtime (ended {_fmt(last.ended_at, cs)}).")
    try:
        with transaction.atomic():
            session = OvertimeSession.objects.create(
                employee=employee, attendance=record, date=day, started_at=at, source=source
            )
    except IntegrityError:
        raise Conflict("Overtime is already running.") from None
    notify(
        _overtime_recipients(employee),
        Notification.Type.OVERTIME_STARTED,
        f"{employee.user.full_name} started overtime",
        f"Started at {_fmt(at, cs)} on {day:%d %b %Y}.",
        obj=session,
    )
    audit.record(request, "OVERTIME_STARTED", obj=session, metadata={"date": day, "source": source})
    return session


@transaction.atomic
def end_overtime(request, at=None, source=SessionSource.ONLINE):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    at = at or timezone.now()
    session = OvertimeSession.objects.select_for_update().filter(employee=employee, status=SessionStatus.ACTIVE).first()
    if session is None:
        raise Conflict("No overtime is running.")
    if at < session.started_at:
        raise Conflict("Overtime cannot end before it started.")
    session.ended_at = at
    session.duration_seconds = _seconds(session.started_at, at)
    session.status = SessionStatus.COMPLETED
    session.save(update_fields=["ended_at", "duration_seconds", "status", "updated_at"])
    minutes = session.duration_seconds // 60
    notify(
        _overtime_recipients(employee),
        Notification.Type.OVERTIME_COMPLETED,
        f"{employee.user.full_name} completed overtime",
        f"{minutes // 60}h {minutes % 60:02d}m on {session.date:%d %b %Y}.",
        obj=session,
    )
    audit.record(
        request,
        "OVERTIME_COMPLETED",
        obj=session,
        metadata={"duration_seconds": session.duration_seconds, "source": source},
    )
    return session


# --- idempotent events -----------------------------------------------------------------

HANDLERS = {
    SyncEvent.Type.BREAK_START: start_break,
    SyncEvent.Type.BREAK_END: end_break,
    SyncEvent.Type.OVERTIME_START: start_overtime,
    SyncEvent.Type.OVERTIME_END: end_overtime,
}


def _message(exc):
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        first = next(iter(detail.values()), "")
        detail = first[0] if isinstance(first, list) and first else first
    elif isinstance(detail, list) and detail:
        detail = detail[0]
    return str(detail or exc)[:500]


def record_event(request, client_event_id, event_type, channel, client_timestamp=None):
    """Apply one event at most once. Returns (SyncEvent, duplicate: bool).

    The SyncEvent row is inserted in the same transaction as the state change, so a
    concurrent duplicate blocks on the unique index and then sees the first result."""
    user = request.user
    existing = SyncEvent.objects.filter(user=user, client_event_id=client_event_id).first()
    if existing is not None:
        return existing, True

    now = timezone.now()
    employee = Employee.objects.filter(user=user).first()
    event = SyncEvent(
        user=user,
        employee=employee,
        client_event_id=client_event_id,
        event_type=event_type,
        channel=channel,
        client_timestamp=client_timestamp,
    )
    if channel == SyncEvent.Channel.OFFLINE:
        at = client_timestamp
        if at is None:
            event.status, event.error = SyncEvent.Status.REJECTED, "The event has no timestamp."
        elif at > now + OFFLINE_MAX_CLOCK_SKEW:
            event.status, event.error = SyncEvent.Status.REJECTED, "The event time is in the future (device clock?)."
        elif now - at > OFFLINE_MAX_AGE:
            event.status, event.error = SyncEvent.Status.REJECTED, "The event is too old to synchronise."
        at = min(at, now) if at else None
    else:
        at = now

    source = SessionSource.OFFLINE if channel == SyncEvent.Channel.OFFLINE else SessionSource.ONLINE
    try:
        with transaction.atomic():
            if not event.status:
                event.effective_at = at
                try:
                    with transaction.atomic():
                        obj = HANDLERS[event_type](request, at=at, source=source)
                    event.status = SyncEvent.Status.APPLIED
                    event.entity_type, event.entity_id = obj._meta.label, str(obj.pk)
                except Conflict as exc:
                    event.status, event.error = SyncEvent.Status.CONFLICT, _message(exc)
                except (ValidationError, PermissionDenied, APIException) as exc:
                    event.status, event.error = SyncEvent.Status.REJECTED, _message(exc)
            event.save()
    except IntegrityError:
        return SyncEvent.objects.get(user=user, client_event_id=client_event_id), True

    if channel == SyncEvent.Channel.OFFLINE and event.status != SyncEvent.Status.APPLIED:
        audit.record(
            request,
            "OFFLINE_SYNC_CONFLICT" if event.status == SyncEvent.Status.CONFLICT else "OFFLINE_SYNC_REJECTED",
            obj=event,
            metadata={"event_type": event_type, "error": event.error},
        )
    return event, False


def sync_batch(request, events):
    """Apply queued offline events in the order they happened on the device."""
    ordered = sorted(events, key=lambda e: (e["occurred_at"], str(e["id"])))
    results = []
    for item in ordered:
        event, duplicate = record_event(
            request, item["id"], item["type"], SyncEvent.Channel.OFFLINE, client_timestamp=item["occurred_at"]
        )
        results.append({"event": event, "duplicate": duplicate})
    failed = [r for r in results if not r["duplicate"] and r["event"].status != SyncEvent.Status.APPLIED]
    if failed:
        notify(
            [request.user],
            Notification.Type.SYNC_STATUS,
            "Some offline activity could not be synchronised",
            f"{len(failed)} of {len(results)} offline event(s) were not applied. "
            "Open Attendance to review your work session.",
        )
    return results


def today_state(user):
    """Everything the work-session card needs, computed from server state."""
    cs = CompanySettings.get_solo()
    day = cs.today()
    employee = Employee.objects.filter(user=user).first()
    record = active_break = active_overtime = None
    breaks = overtime = []
    if employee is not None:
        record = AttendanceRecord.objects.filter(employee=employee, date=day).first()
        breaks = list(BreakSession.objects.filter(attendance=record).order_by("started_at")) if record else []
        active_break = BreakSession.objects.filter(employee=employee, status=SessionStatus.ACTIVE).first()
        active_overtime = OvertimeSession.objects.filter(employee=employee, status=SessionStatus.ACTIVE).first()
        overtime = list(OvertimeSession.objects.filter(employee=employee, date=day).order_by("started_at"))
    return {
        "cs": cs,
        "date": day,
        "record": record,
        "breaks": breaks,
        "active_break": active_break,
        "overtime": overtime,
        "active_overtime": active_overtime,
    }
