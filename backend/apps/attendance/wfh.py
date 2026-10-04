"""Work-from-home requests: employee asks for a date, HR / a Super Admin decides.

Only an APPROVED request whose date is today lets the employee check in with
mode=WORK_FROM_HOME; the check-in service asks `approved_request_for`, never the client.
An approval is valid for its own date only (it "expires" with that day)."""

import datetime

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.services import users_with_permission
from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.organization.models import CompanySettings

from .models import AttendanceRecord, WorkFromHomeRequest
from .sessions import _employee

MAX_DAYS_AHEAD = 90
OPEN = (WorkFromHomeRequest.Status.PENDING, WorkFromHomeRequest.Status.APPROVED)


def approved_request_for(employee, day):
    return WorkFromHomeRequest.objects.filter(
        employee=employee, date=day, status=WorkFromHomeRequest.Status.APPROVED
    ).first()


def request_for_day(employee, day):
    """Today's open (pending or approved) request, for the work-session UI."""
    return WorkFromHomeRequest.objects.filter(employee=employee, date=day, status__in=OPEN).first()


@transaction.atomic
def create_request(request, *, date, reason, remarks=""):
    cs = CompanySettings.get_solo()
    employee = _employee(request.user, cs, lock=True)
    today = cs.today()
    if date < today:
        raise ValidationError({"date": ["Choose today or a later date."]})
    if date > today + datetime.timedelta(days=MAX_DAYS_AHEAD):
        raise ValidationError({"date": [f"Requests can be made up to {MAX_DAYS_AHEAD} days ahead."]})
    checked_in = AttendanceRecord.objects.filter(employee=employee, date=today, check_in__isnull=False).exists()
    if date == today and checked_in:
        raise Conflict("You have already checked in today.")
    if WorkFromHomeRequest.objects.filter(employee=employee, date=date, status__in=OPEN).exists():
        raise Conflict("You already have a work-from-home request for this date.")
    try:
        with transaction.atomic():
            wfh = WorkFromHomeRequest.objects.create(employee=employee, date=date, reason=reason, remarks=remarks)
    except IntegrityError:
        raise Conflict("You already have a work-from-home request for this date.") from None
    notify(
        [u for u in users_with_permission("wfh.approve") if u.pk != request.user.pk],
        Notification.Type.WFH_REQUESTED,
        f"{employee.user.full_name} requested work from home",
        f"{date:%a %d %b %Y}: {reason[:300]}",
        obj=wfh,
    )
    audit.record(request, "WFH_REQUESTED", obj=wfh, metadata={"date": date})
    return wfh


@transaction.atomic
def decide(request, wfh, approve, note=""):
    wfh = WorkFromHomeRequest.objects.select_for_update().select_related("employee__user").get(pk=wfh.pk)
    if wfh.status != WorkFromHomeRequest.Status.PENDING:
        raise Conflict(f"This request is already {wfh.get_status_display().lower()}.")
    if wfh.employee.user_id == request.user.pk:
        raise PermissionDenied("You cannot decide your own work-from-home request.")
    if approve and wfh.date < CompanySettings.get_solo().today():
        raise Conflict("This date has passed; the request can no longer be approved.")
    wfh.status = WorkFromHomeRequest.Status.APPROVED if approve else WorkFromHomeRequest.Status.REJECTED
    wfh.decided_by = request.user
    wfh.decided_at = timezone.now()
    wfh.decision_note = note
    wfh.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    notify(
        [wfh.employee.user],
        Notification.Type.WFH_APPROVED if approve else Notification.Type.WFH_REJECTED,
        f"Work from home {'approved' if approve else 'rejected'} for {wfh.date:%d %b %Y}",
        ("You can check in from home on that day." if approve else "Please work from the office on that day.")
        + (f" Note: {note}" if note else ""),
        obj=wfh,
        email=True,
    )
    audit.record(
        request,
        "WFH_APPROVED" if approve else "WFH_REJECTED",
        obj=wfh,
        metadata={"date": wfh.date, "employee": wfh.employee_id, "note": note},
    )
    return wfh


@transaction.atomic
def cancel(request, wfh):
    wfh = WorkFromHomeRequest.objects.select_for_update().get(pk=wfh.pk)
    if wfh.employee.user_id != request.user.pk:
        raise PermissionDenied("Only the employee can cancel their request.")
    if wfh.status not in OPEN:
        raise Conflict(f"This request is already {wfh.get_status_display().lower()}.")
    today = CompanySettings.get_solo().today()
    if wfh.date < today:
        raise Conflict("This date has passed.")
    used = AttendanceRecord.objects.filter(wfh_request=wfh, check_in__isnull=False).exists()
    if used:
        raise Conflict("You have already checked in from home with this approval.")
    wfh.status = WorkFromHomeRequest.Status.CANCELLED
    wfh.cancelled_at = timezone.now()
    wfh.save(update_fields=["status", "cancelled_at", "updated_at"])
    audit.record(request, "WFH_CANCELLED", obj=wfh, metadata={"date": wfh.date})
    return wfh
