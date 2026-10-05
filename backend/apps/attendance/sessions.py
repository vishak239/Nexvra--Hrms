"""Work-session events: breaks and overtime, plus idempotent offline synchronisation.

Rules (all enforced here, on the server):

* A break needs today's check-in, no check-out yet, and no other active break. Breaks never
  overlap. Several breaks per day are allowed, up to CompanySettings.break_allowance_minutes
  in total (owner policy: 60). A break cannot start once the allowance is used up, and a break
  still running when the allowance runs out is closed at that exact moment
  (end_reason=ALLOWANCE_EXHAUSTED), so the day's total can never exceed the allowance.
  Ending a break adds its duration to AttendanceRecord.total_break_seconds, which is
  subtracted from worked time.
* Overtime starts only after the day's normal check-out. Before any overtime the employee
  declares the tasks (or another reason) and confirms it. With overtime_requires_approval the
  declaration is a REQUESTED session that HR / a Super Admin must approve before it can start;
  without it the declaration starts the session directly. At most one session runs, one
  request is open, and sessions never overlap. Its duration is never added to worked time.
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

from apps.accounts.services import users_with_permission
from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings
from apps.tasks.models import Task

from .errors import BreakAllowanceUsed, InMeeting
from .models import (
    OVERTIME_ENDED,
    OVERTIME_OPEN,
    AttendanceRecord,
    BreakSession,
    MeetingPause,
    NonWorkingPeriod,
    OvertimeSession,
    OvertimeStatus,
    SessionSource,
    SessionStatus,
    SyncEvent,
)

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


# --- break allowance -------------------------------------------------------------------


def allowance_seconds(cs):
    return None if cs.break_allowance_minutes is None else cs.break_allowance_minutes * 60


def allowance_end(session, record, cs):
    """When the running break uses up the day's allowance (None = no allowance configured)."""
    allowance = allowance_seconds(cs)
    if allowance is None:
        return None
    return session.started_at + datetime.timedelta(seconds=max(0, allowance - record.total_break_seconds))


def break_usage(record, active_break, cs, now):
    """(used_seconds, remaining_seconds|None) for the day, computed on the server."""
    used = record.total_break_seconds if record else 0
    if record is not None and active_break is not None and active_break.attendance_id == record.pk:
        end = allowance_end(active_break, record, cs)
        until = min(now, end) if end else now
        used += _seconds(active_break.started_at, max(until, active_break.started_at))
    allowance = allowance_seconds(cs)
    return used, (None if allowance is None else max(0, allowance - used))


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
    if MeetingPause.objects.filter(employee=employee, status=SessionStatus.ACTIVE).exists():
        raise InMeeting("A meeting is in progress — your working time is already paused, so no break is needed.")
    allowance = allowance_seconds(cs)
    if allowance is not None and record.total_break_seconds >= allowance:
        raise BreakAllowanceUsed(
            f"Your {cs.break_allowance_minutes}-minute break allowance for today is used up."
        )
    last = BreakSession.objects.filter(attendance=record, status=SessionStatus.COMPLETED).order_by("-ended_at").first()
    if last is not None and at < last.ended_at:
        raise Conflict(f"A break cannot overlap your previous break (ended {_fmt(last.ended_at, cs)}).")
    try:
        with transaction.atomic():
            session = BreakSession.objects.create(attendance=record, employee=employee, started_at=at, source=source)
    except IntegrityError:
        raise Conflict("You are already on a break.") from None
    if record.last_activity_at is None or at > record.last_activity_at:
        record.last_activity_at = at  # starting a break is the employee's own action
        record.save(update_fields=["last_activity_at", "updated_at"])
    audit.record(request, "ATTENDANCE_BREAK_STARTED", obj=session, metadata={"source": source})
    return session


def close_break(session, at, cs, reason=BreakSession.EndReason.MANUAL):
    """End a break at `at`, but never later than the moment the allowance ran out."""
    record = AttendanceRecord.objects.select_for_update().get(pk=session.attendance_id)
    end = allowance_end(session, record, cs)
    if end is not None and at >= end:
        at, reason = end, BreakSession.EndReason.ALLOWANCE_EXHAUSTED
    at = max(at, session.started_at)
    session.ended_at = at
    session.duration_seconds = _seconds(session.started_at, at)
    session.status = SessionStatus.COMPLETED
    session.end_reason = reason
    session.save(update_fields=["ended_at", "duration_seconds", "status", "end_reason", "updated_at"])
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
        # "Back to work" after the allowance already closed the break: nothing left to end, so
        # the click succeeds (and still counts as activity) instead of failing confusingly.
        auto_closed = (
            BreakSession.objects.filter(
                employee=employee,
                attendance__date=_day(at, cs),
                end_reason=BreakSession.EndReason.ALLOWANCE_EXHAUSTED,
                ended_at__lte=at,
            )
            .select_related("attendance")
            .order_by("-ended_at")
            .first()
        )
        if auto_closed is None or auto_closed.attendance.check_out is not None:
            raise Conflict("You are not on a break.")
        record = AttendanceRecord.objects.select_for_update().get(pk=auto_closed.attendance_id)
        if record.last_activity_at is None or at > record.last_activity_at:
            record.last_activity_at = at
            record.save(update_fields=["last_activity_at", "updated_at"])
        return auto_closed
    if at < session.started_at:
        raise Conflict("A break cannot end before it started.")
    record = close_break(session, at, cs)
    # The employee just acted ("Back to work"), so this is real activity.
    if record.last_activity_at is None or at > record.last_activity_at:
        record.last_activity_at = at
        record.save(update_fields=["last_activity_at", "updated_at"])
    audit.record(
        request,
        "ATTENDANCE_BREAK_ENDED",
        obj=session,
        metadata={"duration_seconds": session.duration_seconds, "source": source, "reason": session.end_reason},
    )
    return session


def close_open_break_at_checkout(record, at, cs=None):
    """Called by every check-out (manual or automatic): an open break ends at check-out time
    (or earlier, when the allowance ran out first)."""
    session = BreakSession.objects.select_for_update().filter(attendance=record, status=SessionStatus.ACTIVE).first()
    if session is None:
        return record
    return close_break(session, max(at, session.started_at), cs or CompanySettings.get_solo(),
                       reason=BreakSession.EndReason.CHECKOUT)


# --- overtime --------------------------------------------------------------------------


def _manager(employee):
    return [employee.manager.user] if employee.manager_id else []


def _expire_stale_requests(employee, day):
    """An approval is valid for its own date only; unused older requests are closed."""
    OvertimeSession.objects.filter(employee=employee, status__in=OVERTIME_OPEN, date__lt=day).update(
        status=OvertimeStatus.CANCELLED, end_reason=OvertimeSession.EndReason.EXPIRED, updated_at=timezone.now()
    )


def _assert_after_checkout(employee, at, cs):
    record = AttendanceRecord.objects.filter(employee=employee, date=_day(at, cs)).first()
    if record is None or record.check_out is None:
        raise Conflict("Overtime starts after your normal check-out. Check out first.")
    if at < record.check_out:
        raise Conflict("Overtime cannot start before your normal check-out time.")
    return record


def _assert_no_overlap(employee, at, cs):
    if OvertimeSession.objects.filter(employee=employee, status=OvertimeStatus.ACTIVE).exists():
        raise Conflict("Overtime is already running.")
    last = OvertimeSession.objects.filter(employee=employee, status__in=OVERTIME_ENDED).order_by("-ended_at").first()
    if last is not None and at < last.ended_at:
        raise Conflict(f"Overtime cannot overlap your previous overtime (ended {_fmt(last.ended_at, cs)}).")


def _activate(request, session, at, record, cs, source):
    session.status = OvertimeStatus.ACTIVE
    session.started_at = at
    session.last_activity_at = at
    session.attendance = record
    session.source = source
    session.save()
    notify(
        _manager(session.employee),
        Notification.Type.OVERTIME_STARTED,
        f"{session.employee.user.full_name} started overtime",
        f"Started at {_fmt(at, cs)} on {session.date:%d %b %Y}.",
        obj=session,
    )
    audit.record(request, "OVERTIME_STARTED", obj=session, metadata={"date": session.date, "source": source})
    return session


@transaction.atomic
def request_overtime(request, *, task_ids, work_description, other_reason):
    """The overtime declaration (tasks or another reason, description, confirmation). The
    serializer has already checked that the declaration is complete and confirmed."""
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    now = timezone.now()
    day = _day(now, cs)
    record = _assert_after_checkout(employee, now, cs)
    _assert_no_overlap(employee, now, cs)
    _expire_stale_requests(employee, day)
    open_request = OvertimeSession.objects.filter(employee=employee, status__in=OVERTIME_OPEN).first()
    if open_request is not None:
        raise Conflict(f"You already have an overtime request for today ({open_request.get_status_display().lower()}).")
    tasks = list(Task.objects.filter(pk__in=task_ids, assigned_to=employee, status__in=Task.OPEN_STATUSES))
    if len(tasks) != len(set(task_ids)):
        raise ValidationError({"task_ids": ["Choose only your own open tasks."]})

    session = OvertimeSession(
        employee=employee,
        attendance=record,
        date=day,
        work_description=work_description,
        other_reason=other_reason,
        declaration_confirmed=True,
        requested_at=now,
        status=OvertimeStatus.REQUESTED,
    )
    try:
        with transaction.atomic():
            session.save()
    except IntegrityError:
        raise Conflict("You already have an open overtime request.") from None
    session.tasks.set(tasks)
    audit.record(
        request,
        "OVERTIME_REQUESTED",
        obj=session,
        metadata={"tasks": [t.pk for t in tasks], "other_reason": bool(other_reason)},
    )
    if cs.overtime_requires_approval:
        notify(
            [u for u in users_with_permission("overtime.approve") if u.pk != request.user.pk],
            Notification.Type.OVERTIME_REQUESTED,
            f"{employee.user.full_name} requested overtime",
            work_description[:300],
            obj=session,
        )
        return session
    return _activate(request, session, now, record, cs, SessionSource.ONLINE)


@transaction.atomic
def decide_overtime(request, session, approve, note=""):
    session = OvertimeSession.objects.select_for_update().select_related("employee__user").get(pk=session.pk)
    if session.status != OvertimeStatus.REQUESTED:
        raise Conflict(f"This overtime request is already {session.get_status_display().lower()}.")
    if session.employee.user_id == request.user.pk:
        raise PermissionDenied("You cannot decide your own overtime request.")
    cs = CompanySettings.get_solo()
    if approve and session.date < cs.today():
        raise Conflict("This request was for an earlier day and can no longer be approved.")
    session.status = OvertimeStatus.APPROVED if approve else OvertimeStatus.REJECTED
    session.decided_by = request.user
    session.decided_at = timezone.now()
    session.decision_note = note
    session.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    notify(
        [session.employee.user],
        Notification.Type.OVERTIME_APPROVED if approve else Notification.Type.OVERTIME_REJECTED,
        "Your overtime request was approved" if approve else "Your overtime request was rejected",
        (f"You can start overtime today ({session.date:%d %b %Y})." if approve else "Your overtime was not approved.")
        + (f" Note: {note}" if note else ""),
        obj=session,
        email=True,
    )
    audit.record(
        request, "OVERTIME_APPROVED" if approve else "OVERTIME_REJECTED", obj=session, metadata={"note": note}
    )
    return session


@transaction.atomic
def cancel_overtime(request, session):
    session = OvertimeSession.objects.select_for_update().get(pk=session.pk)
    if session.employee.user_id != request.user.pk:
        raise PermissionDenied("Only the employee can cancel their overtime request.")
    if session.status not in OVERTIME_OPEN:
        raise Conflict("Only a requested or approved overtime that has not started can be cancelled.")
    session.status = OvertimeStatus.CANCELLED
    session.save(update_fields=["status", "updated_at"])
    audit.record(request, "OVERTIME_CANCELLED", obj=session)
    return session


@transaction.atomic
def start_overtime(request, at=None, source=SessionSource.ONLINE):
    """Starts today's APPROVED overtime (also used for queued offline starts). Without an
    approval workflow, overtime is started by submitting the declaration instead."""
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    at = at or timezone.now()
    day = _day(at, cs)
    record = _assert_after_checkout(employee, at, cs)
    _assert_no_overlap(employee, at, cs)
    session = (
        OvertimeSession.objects.select_for_update()
        .filter(employee=employee, status=OvertimeStatus.APPROVED, date=day)
        .first()
    )
    if session is None:
        if cs.overtime_requires_approval:
            raise Conflict("Overtime needs an approved request for today. Submit your overtime request first.")
        raise Conflict("Fill in the overtime declaration to start overtime.")
    return _activate(request, session, at, record, cs, source)


def _finish(session, at, status, reason):
    session.ended_at = max(at, session.started_at)
    session.duration_seconds = _seconds(session.started_at, session.ended_at)
    session.status = status
    session.end_reason = reason
    session.save(update_fields=["ended_at", "duration_seconds", "status", "end_reason", "updated_at"])
    return session


@transaction.atomic
def end_overtime(request, at=None, source=SessionSource.ONLINE):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    at = at or timezone.now()
    session = (
        OvertimeSession.objects.select_for_update().filter(employee=employee, status=OvertimeStatus.ACTIVE).first()
    )
    if session is None:
        raise Conflict("No overtime is running.")
    if at < session.started_at:
        raise Conflict("Overtime cannot end before it started.")
    _finish(session, at, OvertimeStatus.COMPLETED, OvertimeSession.EndReason.MANUAL)
    minutes = session.duration_seconds // 60
    notify(
        _manager(employee),
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


def auto_stop_overtime(session, at, cs, request=None):
    """Inactivity rule for overtime. Idempotent (only an ACTIVE session is stopped). Restarting
    needs a new declaration (and approval, when required): a stopped session never resumes."""
    if session.status != OvertimeStatus.ACTIVE:
        return False
    _finish(session, at, OvertimeStatus.AUTO_STOPPED, OvertimeSession.EndReason.OVERTIME_INACTIVITY_TIMEOUT)
    audit.record(
        request,
        "OVERTIME_AUTO_STOPPED",
        obj=session,
        metadata={
            "reason": session.end_reason,
            "last_activity_at": session.last_activity_at,
            "duration_seconds": session.duration_seconds,
        },
        actor=None,
    )
    notify(
        [session.employee.user],
        Notification.Type.OVERTIME_AUTO_STOPPED,
        "Your overtime was stopped automatically",
        f"No activity for {cs.inactivity_timeout_minutes} minutes; overtime ended at {_fmt(session.ended_at, cs)}. "
        "To continue, submit a new overtime request.",
        obj=session,
    )
    return True


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


def today_state(user, now=None):
    """Everything the work-session UI needs, computed from server state."""
    from .meetings import active_meeting_for
    from .resume import latest_for
    from .wfh import request_for_day

    cs = CompanySettings.get_solo()
    now = now or timezone.now()
    day = _day(now, cs)
    employee = Employee.objects.filter(user=user).first()
    record = active_break = active_overtime = open_overtime = wfh = None
    active_meeting = active_pause = open_non_working = resume_request = None
    breaks = overtime = meeting_pauses = non_working = []
    if employee is not None:
        record = AttendanceRecord.objects.filter(employee=employee, date=day).first()
        breaks = list(BreakSession.objects.filter(attendance=record).order_by("started_at")) if record else []
        active_break = BreakSession.objects.filter(employee=employee, status=SessionStatus.ACTIVE).first()
        overtime = list(
            OvertimeSession.objects.filter(employee=employee, date=day, started_at__isnull=False)
            .prefetch_related("tasks")
            .order_by("started_at")
        )
        active_overtime = next((o for o in overtime if o.status == OvertimeStatus.ACTIVE), None)
        open_overtime = (
            OvertimeSession.objects.filter(employee=employee, status__in=OVERTIME_OPEN, date=day)
            .prefetch_related("tasks")
            .first()
        )
        wfh = request_for_day(employee, day)
        active_meeting = active_meeting_for(employee)
        active_pause = MeetingPause.objects.filter(employee=employee, status=SessionStatus.ACTIVE).first()
        if record is not None:
            meeting_pauses = list(MeetingPause.objects.filter(attendance=record).select_related("meeting")
                                  .order_by("started_at"))
            non_working = list(NonWorkingPeriod.objects.filter(attendance=record).order_by("started_at"))
            open_non_working = next((p for p in non_working if p.ended_at is None), None)
        resume_request = latest_for(employee, day)
    used, remaining = break_usage(record, active_break, cs, now)
    return {
        "cs": cs,
        "now": now,
        "date": day,
        "record": record,
        "breaks": breaks,
        "active_break": active_break,
        "break_used_seconds": used,
        "break_remaining_seconds": remaining,
        "overtime": overtime,
        "active_overtime": active_overtime,
        "open_overtime": open_overtime,
        "wfh": wfh,
        "active_meeting": active_meeting,
        "active_pause": active_pause,
        "meeting_pauses": meeting_pauses,
        "non_working": non_working,
        "open_non_working": open_non_working,
        "resume_request": resume_request,
    }
