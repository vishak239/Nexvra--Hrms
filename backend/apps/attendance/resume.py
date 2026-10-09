"""Resume Work: after an automatic inactivity check-out, the employee asks to continue working.

Flow (server-controlled):

* Only after today's INACTIVITY_TIMEOUT check-out, with a reason. One open (pending or
  approved) request per employee; after a rejection a new request can be sent.
* HR / Super Admin (permission resume.approve) approve or reject; nobody decides their own.
* Approval does NOT check the employee in. The next check-in (services.check_in) uses the
  approval, runs the normal geofence / work-from-home validation again and reopens the day's
  session; the gap since the automatic check-out is recorded as non-working time.
* A rejected request leaves the employee checked out; normal check-in stays blocked.
* Requests are valid for their own day only; unused older ones expire.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.accounts.services import users_with_permission
from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.core.timefmt import fmt_time
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from .models import AttendanceRecord, ResumeWorkRequest
from .sessions import _employee


def expire_stale(employee=None, today=None):
    """Open requests from earlier days can no longer be used."""
    today = today or CompanySettings.get_solo().today()
    qs = ResumeWorkRequest.objects.filter(status__in=ResumeWorkRequest.OPEN, date__lt=today)
    if employee is not None:
        qs = qs.filter(employee=employee)
    return qs.update(status=ResumeWorkRequest.Status.EXPIRED, updated_at=timezone.now())


def latest_for(employee, day):
    """Today's most recent request (any status) for the work-session UI."""
    return ResumeWorkRequest.objects.filter(employee=employee, date=day).select_related("decided_by").first()


@transaction.atomic
def create_request(request, *, reason):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    today = cs.today()
    expire_stale(employee, today)
    record = AttendanceRecord.objects.select_for_update().filter(employee=employee, date=today).first()
    if record is None or record.check_in is None:
        raise Conflict("You have not checked in today. Use Check in to start working.")
    if record.check_out is None:
        raise Conflict("You are already working; there is nothing to resume.")
    if record.checkout_reason != AttendanceRecord.CheckoutReason.INACTIVITY_TIMEOUT:
        raise Conflict("Resume Work is only for an automatic check-out after inactivity.")
    open_request = ResumeWorkRequest.objects.filter(employee=employee, status__in=ResumeWorkRequest.OPEN).first()
    if open_request is not None:
        raise Conflict(f"You already have a Resume Work request ({open_request.get_status_display().lower()}).")
    try:
        with transaction.atomic():
            obj = ResumeWorkRequest.objects.create(
                employee=employee, attendance=record, date=today, reason=reason, checked_out_at=record.check_out
            )
    except IntegrityError:
        raise Conflict("You already have an open Resume Work request.") from None
    audit.record(request, "RESUME_WORK_REQUESTED", obj=obj, metadata={"date": today})
    notify(
        [u for u in users_with_permission("resume.approve") if u.pk != request.user.pk],
        Notification.Type.RESUME_REQUESTED,
        f"{employee.user.full_name} asks to resume work",
        f"Checked out automatically at {fmt_time(record.check_out, cs.tz)}. Reason: {reason[:300]}",
        obj=obj,
    )
    return obj


@transaction.atomic
def decide(request, obj, approve, note=""):
    obj = ResumeWorkRequest.objects.select_for_update().select_related("employee__user").get(pk=obj.pk)
    if obj.employee.user_id == request.user.pk:
        raise PermissionDenied("You cannot decide your own Resume Work request.")
    if obj.status != ResumeWorkRequest.Status.PENDING:
        raise Conflict(f"This request is already {obj.get_status_display().lower()}.")
    cs = CompanySettings.get_solo()
    if approve and obj.date < cs.today():
        raise Conflict("This request was for an earlier day and can no longer be approved.")
    obj.status = ResumeWorkRequest.Status.APPROVED if approve else ResumeWorkRequest.Status.REJECTED
    obj.decided_by = request.user
    obj.decided_at = timezone.now()
    obj.decision_note = note
    obj.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    audit.record(request, "RESUME_WORK_APPROVED" if approve else "RESUME_WORK_REJECTED", obj=obj,
                 metadata={"note": note})
    notify(
        [obj.employee.user],
        Notification.Type.RESUME_APPROVED if approve else Notification.Type.RESUME_REJECTED,
        "Resume approved — check in to continue working" if approve else "Your Resume Work request was rejected",
        (
            "Check in again to continue working (the usual location / work-from-home rules apply)."
            if approve
            else "You remain checked out for today."
        )
        + (f" Note: {note}" if note else ""),
        obj=obj,
    )
    return obj


@transaction.atomic
def cancel(request, obj):
    obj = ResumeWorkRequest.objects.select_for_update().select_related("employee").get(pk=obj.pk)
    if obj.employee.user_id != request.user.pk:
        raise PermissionDenied("Only the employee can cancel their Resume Work request.")
    if obj.status not in ResumeWorkRequest.OPEN:
        raise Conflict("Only a pending or approved request that has not been used can be cancelled.")
    obj.status = ResumeWorkRequest.Status.CANCELLED
    obj.save(update_fields=["status", "updated_at"])
    audit.record(request, "RESUME_WORK_CANCELLED", obj=obj)
    return obj
