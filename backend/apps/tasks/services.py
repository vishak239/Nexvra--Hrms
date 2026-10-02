"""Task workflow. State changes happen here, inside transactions with row locks, and the
caller's identity always comes from the authenticated request - never from the payload."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts import usernames
from apps.audit import services as audit
from apps.core.exceptions import Conflict
from apps.employees.models import Employee
from apps.notifications.models import Notification
from apps.notifications.services import notify

from .models import Task, TaskResponse

EDITABLE_FIELDS = ["title", "description", "priority", "due_date", "requires_response"]


def handle(user):
    return f"@{user.username}" if user.username else user.full_name


def resolve_assignee(employee_code=None, username=None):
    """Find the active employee for EITHER an Employee ID or a username (exactly one)."""
    employee_code = (employee_code or "").strip()
    username = usernames.normalize(username)
    if bool(employee_code) == bool(username):
        raise ValidationError(
            {"non_field_errors": ["Identify the employee by Employee ID or by username (one of them)."]}
        )
    qs = Employee.objects.select_related("user", "department", "designation").exclude(
        employment_status=Employee.Status.EXITED
    )
    if employee_code:
        employee = qs.filter(employee_code__iexact=employee_code).first()
        field, label = "employee_code", "Employee ID"
    else:
        employee = qs.filter(user__username=username).first()
        field, label = "username", "username"
    if employee is None or not employee.user.is_active:
        raise ValidationError({field: [f"No active employee found with this {label}."]})
    return employee, field


def _lock(task):
    return Task.objects.select_for_update(of=("self",)).select_related("assigned_to__user", "assigned_by").get(
        pk=task.pk
    )


def _assert_open(task, verb):
    if not task.is_open:
        raise Conflict(f"This task is {task.get_status_display().lower()} and can no longer be {verb}.")


def _assert_assignee(user, task):
    if task.assigned_to.user_id != user.pk:
        raise PermissionDenied("Only the assigned employee can do this.")


def _assert_can_manage(user, task):
    if not user.has_permission("tasks.manage"):
        raise PermissionDenied("You cannot manage tasks.")
    if task.assigned_to.user_id == user.pk and not user.is_super_admin:
        raise PermissionDenied("You cannot manage a task assigned to you.")


@transaction.atomic
def create(request, data):
    employee, looked_up_by = resolve_assignee(data.get("employee_code"), data.get("username"))
    if employee.user_id == request.user.pk:
        raise ValidationError({looked_up_by: ["You cannot assign a task to yourself."]})
    task = Task.objects.create(
        title=data["title"],
        description=data.get("description", ""),
        priority=data.get("priority", Task.Priority.MEDIUM),
        due_date=data.get("due_date"),
        requires_response=data.get("requires_response", True),
        assigned_by=request.user,
        assigned_to=employee,
    )
    due = f" Due {task.due_date:%d %b %Y}." if task.due_date else ""
    notify(
        [employee.user],
        Notification.Type.TASK_ASSIGNED,
        f"{handle(employee.user)}, HR assigned you a new task",
        f"Task assigned to Employee ID {employee.employee_code}: {task.title}.{due}",
        obj=task,
    )
    audit.record(
        request,
        "TASK_CREATED",
        obj=task,
        metadata={
            "assigned_to": employee.pk,
            "employee_code": employee.employee_code,
            "looked_up_by": looked_up_by,
            "priority": task.priority,
            "due_date": task.due_date,
            "requires_response": task.requires_response,
        },
    )
    return task


@transaction.atomic
def update(request, task, data):
    task = _lock(task)
    _assert_can_manage(request.user, task)
    _assert_open(task, "edited")
    fields = [f for f in EDITABLE_FIELDS if f in data]
    before = audit.snapshot(task, fields)
    for field in fields:
        setattr(task, field, data[field])
    task.save()
    audit.record(request, "TASK_UPDATED", obj=task, changes=audit.diff(before, audit.snapshot(task, fields)))
    return task


@transaction.atomic
def cancel(request, task, reason=""):
    task = _lock(task)
    _assert_can_manage(request.user, task)
    _assert_open(task, "cancelled")
    previous = task.status
    task.status = Task.Status.CANCELLED
    task.cancelled_at = timezone.now()
    task.cancelled_by = request.user
    task.cancel_reason = reason
    task.save()
    notify(
        [task.assigned_to.user],
        Notification.Type.TASK_CANCELLED,
        f"Task cancelled: {task.title}",
        reason or "HR cancelled this task. No further action is needed.",
        obj=task,
    )
    audit.record(
        request, "TASK_CANCELLED", obj=task, changes={"status": [previous, task.status]}, metadata={"reason": reason}
    )
    return task


@transaction.atomic
def remind(request, task):
    task = _lock(task)
    _assert_can_manage(request.user, task)
    _assert_open(task, "reminded about")
    notify(
        [task.assigned_to.user],
        Notification.Type.TASK_REMINDER,
        f"{handle(task.assigned_to.user)}, reminder: {task.title}",
        "HR sent a reminder about this task." + (f" Due {task.due_date:%d %b %Y}." if task.due_date else ""),
        obj=task,
    )
    audit.record(request, "TASK_REMINDER_SENT", obj=task)
    return task


@transaction.atomic
def start(request, task):
    task = _lock(task)
    _assert_assignee(request.user, task)
    _assert_open(task, "started")
    if task.status == Task.Status.PENDING:
        task.status = Task.Status.IN_PROGRESS
        task.acknowledged_at = task.acknowledged_at or timezone.now()
        task.save()
        audit.record(request, "TASK_STARTED", obj=task, changes={"status": [Task.Status.PENDING, task.status]})
    return task


def _add_response(request, task, message):
    now = timezone.now()
    TaskResponse.objects.create(task=task, author=request.user, message=message)
    task.response = message
    task.responded_at = now
    if task.status == Task.Status.PENDING:
        task.status = Task.Status.IN_PROGRESS
    task.acknowledged_at = task.acknowledged_at or now


@transaction.atomic
def respond(request, task, message):
    task = _lock(task)
    _assert_assignee(request.user, task)
    _assert_open(task, "responded to")
    previous = task.status
    _add_response(request, task, message)
    task.save()
    if task.assigned_by_id:
        notify(
            [task.assigned_by],
            Notification.Type.TASK_RESPONSE,
            f"{handle(request.user)} responded to: {task.title}",
            message[:300],
            obj=task,
        )
    # The response text is work content kept on the task itself; the audit log only records the event.
    audit.record(
        request,
        "TASK_RESPONDED",
        obj=task,
        changes={"status": [previous, task.status]} if previous != task.status else None,
        metadata={"length": len(message)},
    )
    return task


@transaction.atomic
def complete(request, task, message=""):
    task = _lock(task)
    _assert_assignee(request.user, task)
    _assert_open(task, "completed")
    if message:
        _add_response(request, task, message)
    elif task.requires_response and task.responded_at is None:
        raise ValidationError({"response": ["Add a response before completing this task."]})
    previous = task.status
    task.status = Task.Status.COMPLETED
    task.completed_at = timezone.now()
    task.save()
    if task.assigned_by_id:
        notify(
            [task.assigned_by],
            Notification.Type.TASK_COMPLETED,
            f"{handle(request.user)} completed: {task.title}",
            message[:300] if message else "",
            obj=task,
        )
    audit.record(request, "TASK_COMPLETED", obj=task, changes={"status": [previous, task.status]})
    return task
