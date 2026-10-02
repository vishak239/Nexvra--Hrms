import pytest

from apps.notifications.models import Notification
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db


def test_dashboard_shows_tasks_and_messages_by_role(org, client_for):
    Task.objects.create(title="A", assigned_by=org["hr"].user, assigned_to=org["alice"])
    Task.objects.create(title="C", assigned_by=org["hr"].user, assigned_to=org["carol"])

    alice = client_for(org["alice"]).get("/api/dashboard/").data
    assert alice["me"]["open_tasks"] == 1 and alice["me"]["blocking_tasks"] == 1
    assert alice["unread_messages"] == 0
    assert "tasks_overview" not in alice and "work_sessions_now" not in alice

    assert client_for(org["manager"]).get("/api/dashboard/").data["tasks_overview"]["open"] == 1  # team only
    hr = client_for(org["hr"]).get("/api/dashboard/").data
    assert hr["tasks_overview"] == {"open": 2, "overdue": 0, "awaiting_response": 2}
    assert hr["work_sessions_now"] == {"on_break": 0, "overtime_running": 0}


def test_notifications_carry_a_link(org, client_for):
    task = Task.objects.create(title="A", assigned_by=org["hr"].user, assigned_to=org["alice"])
    Notification.objects.create(
        recipient=org["alice"].user, type="TASK_ASSIGNED", title="t", entity_type="tasks.Task", entity_id=str(task.id)
    )
    Notification.objects.create(recipient=org["alice"].user, type="GENERAL", title="plain")
    rows = client_for(org["alice"]).get("/api/notifications/").data["results"]
    links = {r["title"]: r["link"] for r in rows}
    assert links == {"t": f"/tasks?task={task.id}", "plain": None}
