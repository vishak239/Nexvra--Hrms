"""Company meetings: while a meeting runs, the working time of the people it affects is paused.

Rules (all enforced here, on the server):

* OVERALL meetings affect every current employee; SELECTED meetings only their participants.
* Starting a meeting opens one MeetingPause for each affected employee whose work session is
  open (checked in, not checked out). A break in progress ends at that moment, so a meeting
  never consumes the break allowance and break and meeting time never overlap. Someone who
  checks in (or resumes) while an affecting meeting runs is paused from their check-in.
* During a pause: no inactivity check-out, no geofence check-out, no breaks. The session stays
  open, so nobody has to check in again afterwards.
* Ending a meeting closes its pauses at the end time and adds their length to
  AttendanceRecord.total_meeting_seconds (subtracted from worked time, like breaks). The
  inactivity clock restarts at the end time (see activity.inactivity_deadline).
* At most one overall meeting runs at a time, an overall meeting cannot start while any other
  meeting runs, and nobody can be in two running meetings: each employee has at most one open
  pause (also a database constraint).
* An active meeting with a planned end time is ended automatically at that time.
"""

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from .models import (
    AttendanceRecord,
    BreakSession,
    Meeting,
    MeetingPause,
    OvertimeSession,
    OvertimeStatus,
    SessionStatus,
)
from .sessions import close_break

MAX_PARTICIPANTS = 500


def _seconds(start, end):
    return max(0, int((end - start).total_seconds()))


def _fmt(at, cs=None):
    return timezone.localtime(at, (cs or CompanySettings.get_solo()).tz).strftime("%H:%M")


def affected_employees(meeting):
    """Current employees a meeting applies to."""
    qs = Employee.objects.exclude(employment_status=Employee.Status.EXITED).select_related("user")
    if meeting.kind == Meeting.Kind.SELECTED:
        qs = qs.filter(pk__in=meeting.participants.values("pk"))
    return qs


def active_meeting_for(employee):
    """The running meeting that pauses this employee's work, if any."""
    return (
        Meeting.objects.filter(status=Meeting.Status.ACTIVE)
        .filter(Q(kind=Meeting.Kind.OVERALL) | Q(kind=Meeting.Kind.SELECTED, participants=employee))
        .select_related("created_by", "started_by", "ended_by")
        .prefetch_related("participants__user")
        .order_by("started_at")
        .first()
    )


def open_pause(employee):
    return MeetingPause.objects.filter(employee=employee, status=SessionStatus.ACTIVE).select_related("meeting").first()


def start_pause(record, meeting, at, cs=None):
    """Pause one open work session for `meeting` from `at`. Idempotent per employee."""
    if record.check_in is None or record.check_out is not None:
        return None
    existing = MeetingPause.objects.filter(employee_id=record.employee_id, status=SessionStatus.ACTIVE).first()
    if existing is not None:
        return existing
    at = max(at, record.check_in)
    active_break = (
        BreakSession.objects.select_for_update().filter(attendance=record, status=SessionStatus.ACTIVE).first()
    )
    if active_break is not None:
        close_break(active_break, max(at, active_break.started_at), cs or CompanySettings.get_solo(),
                    reason=BreakSession.EndReason.MEETING)
    try:
        with transaction.atomic():
            return MeetingPause.objects.create(meeting=meeting, attendance=record, employee_id=record.employee_id,
                                               started_at=at)
    except IntegrityError:  # a concurrent start already paused this employee
        return MeetingPause.objects.filter(employee_id=record.employee_id, status=SessionStatus.ACTIVE).first()


def close_pause(pause, at, reason=MeetingPause.EndReason.MEETING_ENDED):
    """End a pause and add its length to the day's meeting time."""
    record = AttendanceRecord.objects.select_for_update().get(pk=pause.attendance_id)
    at = max(at, pause.started_at)
    pause.ended_at = at
    pause.duration_seconds = _seconds(pause.started_at, at)
    pause.status = SessionStatus.COMPLETED
    pause.end_reason = reason
    pause.save(update_fields=["ended_at", "duration_seconds", "status", "end_reason", "updated_at"])
    record.total_meeting_seconds += pause.duration_seconds
    record.save(update_fields=["total_meeting_seconds", "updated_at"])
    return record


def close_open_pause_at_checkout(record, at):
    """Every check-out (manual or automatic) ends an open meeting pause at check-out time. A pause
    that would start after the check-out never belonged to the session and is removed."""
    pause = MeetingPause.objects.select_for_update().filter(attendance=record, status=SessionStatus.ACTIVE).first()
    if pause is None:
        return record
    if pause.started_at > at:
        pause.delete()
        return AttendanceRecord.objects.get(pk=record.pk)
    return close_pause(pause, at, MeetingPause.EndReason.CHECKOUT)


def pause_if_in_meeting(record, at):
    """Called after a check-in / resumed check-in: join the running meeting, if any."""
    meeting = active_meeting_for(record.employee)
    if meeting is not None:
        return start_pause(record, meeting, at)
    return None


def _open_records(employee_ids):
    return (
        AttendanceRecord.objects.select_for_update()
        .filter(employee_id__in=employee_ids, check_in__isnull=False, check_out__isnull=True)
        .order_by("employee_id", "-date")
    )


def _users(employees):
    return [e.user for e in employees]


# --- lifecycle --------------------------------------------------------------------------


def _validate_participants(kind, participants):
    if kind == Meeting.Kind.SELECTED:
        if not participants:
            raise ValidationError({"participant_ids": ["Choose at least one participant."]})
        if len(participants) > MAX_PARTICIPANTS:
            raise ValidationError({"participant_ids": [f"Choose at most {MAX_PARTICIPANTS} participants."]})
        if any(not p.is_current for p in participants):
            raise ValidationError({"participant_ids": ["Former employees cannot be invited."]})


@transaction.atomic
def create_meeting(request, *, title, agenda, kind, participants, scheduled_start=None, scheduled_end=None):
    participants = list(participants) if kind == Meeting.Kind.SELECTED else []
    _validate_participants(kind, participants)
    meeting = Meeting.objects.create(
        title=title,
        agenda=agenda,
        kind=kind,
        scheduled_start=scheduled_start,
        scheduled_end=scheduled_end,
        created_by=request.user,
    )
    meeting.participants.set(participants)
    audit.record(request, "MEETING_CREATED", obj=meeting,
                 metadata={"kind": kind, "participants": [p.pk for p in participants]})
    tz = CompanySettings.get_solo().tz
    when = f" at {timezone.localtime(scheduled_start, tz):%d %b %H:%M}" if scheduled_start else ""
    notify(
        [u for u in _users(affected_employees(meeting)) if u.pk != request.user.pk],
        Notification.Type.MEETING_SCHEDULED,
        f"Meeting scheduled: {title}",
        f"{meeting.get_kind_display()}{when}. Your working time is paused while it runs.",
        obj=meeting,
    )
    return meeting


@transaction.atomic
def update_meeting(request, meeting, *, title=None, agenda=None, participants=None, scheduled_start=None,
                   scheduled_end=None, fields=()):
    """Edit details, or (selected meetings) the participants. Participants can change while a
    meeting runs: a newcomer with an open session is paused now, a removed person resumes now."""
    meeting = Meeting.objects.select_for_update().get(pk=meeting.pk)
    if meeting.status not in (Meeting.Status.SCHEDULED, Meeting.Status.ACTIVE):
        raise Conflict(f"This meeting is {meeting.get_status_display().lower()} and can no longer be changed.")
    if "title" in fields:
        meeting.title = title
    if "agenda" in fields:
        meeting.agenda = agenda
    if meeting.status == Meeting.Status.SCHEDULED:
        if "scheduled_start" in fields:
            meeting.scheduled_start = scheduled_start
    if "scheduled_end" in fields:
        meeting.scheduled_end = scheduled_end
    if meeting.scheduled_start and meeting.scheduled_end and meeting.scheduled_end <= meeting.scheduled_start:
        raise ValidationError({"scheduled_end": ["The end must be after the start."]})
    meeting.save()
    changes = {}
    if participants is not None and meeting.kind == Meeting.Kind.SELECTED:
        participants = list(participants)
        _validate_participants(meeting.kind, participants)
        before = set(meeting.participants.values_list("pk", flat=True))
        after = {p.pk for p in participants}
        added, removed = after - before, before - after
        if meeting.status == Meeting.Status.ACTIVE and added:
            busy = MeetingPause.objects.filter(employee_id__in=added, status=SessionStatus.ACTIVE).exclude(
                meeting=meeting
            )
            if busy.exists():
                raise Conflict("Some of the new participants are already in another running meeting.")
        meeting.participants.set(participants)
        if meeting.status == Meeting.Status.ACTIVE:
            now = timezone.now()
            seen = set()
            for record in _open_records(added):
                if record.employee_id not in seen:
                    seen.add(record.employee_id)
                    start_pause(record, meeting, now)
            for pause in MeetingPause.objects.select_for_update().filter(
                meeting=meeting, employee_id__in=removed, status=SessionStatus.ACTIVE
            ):
                close_pause(pause, now, MeetingPause.EndReason.REMOVED)
        changes = {"added": sorted(added), "removed": sorted(removed)}
        if added:
            notify(
                _users(Employee.objects.filter(pk__in=added).select_related("user")),
                Notification.Type.MEETING_STARTED if meeting.status == Meeting.Status.ACTIVE
                else Notification.Type.MEETING_SCHEDULED,
                f"{'Meeting in progress' if meeting.status == Meeting.Status.ACTIVE else 'Meeting scheduled'}: "
                f"{meeting.title}",
                "Your working time is paused while it runs.",
                obj=meeting,
            )
    audit.record(request, "MEETING_UPDATED", obj=meeting, changes=changes)
    return meeting


@transaction.atomic
def start_meeting(request, meeting):
    meeting = Meeting.objects.select_for_update().get(pk=meeting.pk)
    if meeting.status != Meeting.Status.SCHEDULED:
        raise Conflict(f"This meeting is {meeting.get_status_display().lower()}; only a scheduled meeting can start.")
    running = Meeting.objects.select_for_update().filter(status=Meeting.Status.ACTIVE)
    if meeting.kind == Meeting.Kind.OVERALL and running.exists():
        raise Conflict("Another meeting is running. End it before starting an overall meeting.")
    if meeting.kind == Meeting.Kind.SELECTED:
        if running.filter(kind=Meeting.Kind.OVERALL).exists():
            raise Conflict("An overall meeting is running; everyone's working time is already paused.")
        busy = MeetingPause.objects.filter(
            employee__in=meeting.participants.all(), status=SessionStatus.ACTIVE
        ).select_related("employee__user")
        if busy.exists():
            names = ", ".join(sorted({p.employee.user.full_name for p in busy})[:5])
            raise Conflict(f"Already in another running meeting: {names}.")
        if not meeting.participants.exists():
            raise ValidationError({"participant_ids": ["Choose at least one participant."]})
    now = timezone.now()
    meeting.status = Meeting.Status.ACTIVE
    meeting.started_at = now
    meeting.started_by = request.user
    try:
        with transaction.atomic():
            meeting.save(update_fields=["status", "started_at", "started_by", "updated_at"])
    except IntegrityError:
        raise Conflict("Another overall meeting is already running.") from None

    cs = CompanySettings.get_solo()
    employees = list(affected_employees(meeting))
    paused = 0
    seen = set()
    for record in _open_records([e.pk for e in employees]):
        if record.employee_id in seen:
            continue
        seen.add(record.employee_id)
        if start_pause(record, meeting, now, cs) is not None:
            paused += 1
    audit.record(request, "MEETING_STARTED", obj=meeting, metadata={"kind": meeting.kind, "paused_sessions": paused})
    notify(
        _users(employees),
        Notification.Type.MEETING_STARTED,
        f"Meeting in progress: {meeting.title}",
        f"Started at {_fmt(now, cs)}. Your working time is paused until the meeting ends; you do not need to "
        "check in again afterwards.",
        obj=meeting,
    )
    return meeting


def end_meeting(request, meeting, at=None, reason=Meeting.EndReason.MANUAL):
    with transaction.atomic():
        meeting = Meeting.objects.select_for_update().get(pk=meeting.pk)
        if meeting.status != Meeting.Status.ACTIVE:
            raise Conflict("This meeting is not running.")
        at = max(at or timezone.now(), meeting.started_at)
        meeting.status = Meeting.Status.COMPLETED
        meeting.ended_at = at
        meeting.end_reason = reason
        meeting.ended_by = getattr(request, "user", None) if reason == Meeting.EndReason.MANUAL else None
        meeting.save(update_fields=["status", "ended_at", "end_reason", "ended_by", "updated_at"])
        closed = 0
        for pause in MeetingPause.objects.select_for_update().filter(meeting=meeting, status=SessionStatus.ACTIVE):
            close_pause(pause, at)
            closed += 1
        employees = list(affected_employees(meeting))
        # Overtime has no pause records: the meeting end simply restarts its inactivity clock.
        for session in OvertimeSession.objects.select_for_update().filter(
            employee__in=employees, status=OvertimeStatus.ACTIVE
        ):
            if session.last_activity_at is None or session.last_activity_at < at:
                session.last_activity_at = at
                session.save(update_fields=["last_activity_at", "updated_at"])
        # request is None when the planned end time closed the meeting (system action).
        audit.record(request, "MEETING_ENDED", obj=meeting, metadata={"reason": reason, "closed_pauses": closed})
        cs = CompanySettings.get_solo()
        notify(
            _users(employees),
            Notification.Type.MEETING_ENDED,
            f"Meeting ended: {meeting.title}",
            f"Ended at {_fmt(at, cs)}. Your working time continues automatically.",
            obj=meeting,
        )
    return meeting


@transaction.atomic
def cancel_meeting(request, meeting):
    meeting = Meeting.objects.select_for_update().get(pk=meeting.pk)
    if meeting.status != Meeting.Status.SCHEDULED:
        raise Conflict("Only a scheduled meeting can be cancelled. End a running meeting instead.")
    meeting.status = Meeting.Status.CANCELLED
    meeting.cancelled_at = timezone.now()
    meeting.save(update_fields=["status", "cancelled_at", "updated_at"])
    audit.record(request, "MEETING_CANCELLED", obj=meeting)
    notify(
        [u for u in _users(affected_employees(meeting)) if u.pk != request.user.pk],
        Notification.Type.MEETING_CANCELLED,
        f"Meeting cancelled: {meeting.title}",
        "",
        obj=meeting,
    )
    return meeting


def settle_meetings(now=None):
    """End running meetings whose planned end time has passed (at that time). Idempotent."""
    now = now or timezone.now()
    ended = 0
    for meeting in Meeting.objects.filter(status=Meeting.Status.ACTIVE, scheduled_end__isnull=False,
                                          scheduled_end__lte=now):
        try:
            end_meeting(None, meeting, at=meeting.scheduled_end, reason=Meeting.EndReason.SCHEDULED_END)
            ended += 1
        except Conflict:
            pass  # ended concurrently
    return ended
