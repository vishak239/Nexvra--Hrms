import datetime
from unittest import mock

import pytest

from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.tasks.models import Task, TaskResponse

pytestmark = pytest.mark.django_db


def create(client, **data):
    body = {"title": "Update employee database", "description": "Fix the phone numbers.", **data}
    return client.post("/api/tasks/", body, format="json")


FROZEN = datetime.datetime(2025, 3, 3, 12, 0, tzinfo=datetime.UTC)  # 17:30 IST


def freeze(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


def test_hr_assigns_by_employee_id_and_employee_is_notified(org, client_for):
    alice = org["alice"]
    res = create(client_for(org["hr"]), employee_code=alice.employee_code.lower(), priority="HIGH")
    assert res.status_code == 201, res.data
    task = Task.objects.get(pk=res.data["id"])
    assert task.assigned_to_id == alice.id  # stored as the internal employee id
    assert task.assigned_by_id == org["hr"].user_id
    assert res.data["status"] == "PENDING" and res.data["priority"] == "HIGH"
    note = Notification.objects.get(recipient=alice.user, type="TASK_ASSIGNED")
    assert note.title == f"@{alice.user.username}, HR assigned you a new task"
    assert alice.employee_code in note.message
    assert note.entity_type == "tasks.Task" and note.entity_id == str(task.id)
    log = AuditLog.objects.get(action="TASK_CREATED")
    assert log.metadata["looked_up_by"] == "employee_code"


def test_hr_assigns_by_username_and_relationship_survives_rename(org, client_for):
    alice = org["alice"]
    alice.user.username = "vishak"
    alice.user.save()
    res = create(client_for(org["hr"]), username="@Vishak")
    assert res.status_code == 201, res.data
    assert res.data["assigned_to"]["id"] == alice.id
    alice.user.username = "vishak.renamed"
    alice.user.save()
    task = Task.objects.get(pk=res.data["id"])
    assert task.assigned_to.user.username == "vishak.renamed"
    assert client_for(alice).get(f"/api/tasks/{task.id}/").status_code == 200


def test_lookup_requires_exactly_one_identifier_and_valid_employee(org, client_for, make_employee):
    hr = client_for(org["hr"])
    assert create(hr).status_code == 400  # none
    res = create(hr, employee_code=org["alice"].employee_code, username=org["bob"].user.username)
    assert res.status_code == 400  # both
    res = create(hr, employee_code="NOPE-1")
    assert res.status_code == 400 and "employee_code" in res.data["error"]["fields"]
    res = create(hr, username="ghost")
    assert res.status_code == 400 and "username" in res.data["error"]["fields"]
    exited = make_employee(employment_status="EXITED", exit_date=datetime.date(2024, 6, 1))
    assert create(hr, employee_code=exited.employee_code).status_code == 400
    assert create(hr, employee_code=org["hr"].employee_code).status_code == 400  # not to yourself

    found = hr.get("/api/tasks/lookup/", {"username": org["bob"].user.username})
    assert found.status_code == 200
    assert found.data["employee"]["id"] == org["bob"].id
    assert found.data["looked_up_by"] == "username"


def test_only_task_managers_can_create_lookup_cancel(org, client_for):
    for who in ("alice", "manager"):
        client = client_for(org[who])
        assert create(client, employee_code=org["bob"].employee_code).status_code == 403
        assert client.get("/api/tasks/lookup/", {"employee_code": org["bob"].employee_code}).status_code == 403
    assert create(client_for(org["super_admin"]), employee_code=org["bob"].employee_code).status_code == 201


def test_visibility_by_role(org, client_for):
    hr = client_for(org["hr"])
    ids = {who: create(hr, employee_code=org[who].employee_code).data["id"] for who in ("alice", "bob", "carol")}

    def visible(who):
        return {t["id"] for t in client_for(org[who]).get("/api/tasks/").data["results"]}

    assert visible("alice") == {ids["alice"]}
    assert visible("manager") == {ids["alice"], ids["bob"]}
    assert visible("hr") == visible("super_admin") == set(ids.values())
    assert client_for(org["alice"]).get(f"/api/tasks/{ids['carol']}/").status_code == 404


def test_employee_workflow_start_respond_complete(org, client_for):
    hr = client_for(org["hr"])
    task_id = create(hr, employee_code=org["alice"].employee_code).data["id"]
    alice = client_for(org["alice"])

    res = alice.post(f"/api/tasks/{task_id}/start/")
    assert res.data["status"] == "IN_PROGRESS" and res.data["acknowledged_at"]
    assert alice.post(f"/api/tasks/{task_id}/complete/", {}, format="json").status_code == 400  # response needed
    res = alice.post(f"/api/tasks/{task_id}/respond/", {"message": "Halfway there"}, format="json")
    assert res.data["response"] == "Halfway there" and res.data["responded_at"]
    assert Notification.objects.filter(recipient=org["hr"].user, type="TASK_RESPONSE").exists()
    res = alice.post(f"/api/tasks/{task_id}/complete/", {"message": "All done"}, format="json")
    assert res.data["status"] == "COMPLETED" and res.data["completed_at"]
    assert [r["message"] for r in res.data["responses"]] == ["Halfway there", "All done"]
    assert Notification.objects.filter(recipient=org["hr"].user, type="TASK_COMPLETED").exists()
    assert TaskResponse.objects.filter(task_id=task_id).count() == 2
    # closed tasks cannot change any more
    assert alice.post(f"/api/tasks/{task_id}/respond/", {"message": "again"}, format="json").status_code == 409
    assert hr.post(f"/api/tasks/{task_id}/cancel/").status_code == 409
    actions = set(AuditLog.objects.filter(entity_type="tasks.Task").values_list("action", flat=True))
    assert {"TASK_CREATED", "TASK_STARTED", "TASK_RESPONDED", "TASK_COMPLETED"} <= actions


def test_employee_cannot_modify_ownership_or_manage(org, client_for):
    task_id = create(client_for(org["hr"]), employee_code=org["alice"].employee_code).data["id"]
    alice = client_for(org["alice"])
    res = alice.patch(f"/api/tasks/{task_id}/", {"assigned_to": org["bob"].id, "title": "Mine"}, format="json")
    assert res.status_code == 403
    assert alice.post(f"/api/tasks/{task_id}/cancel/").status_code == 403
    assert alice.post(f"/api/tasks/{task_id}/remind/").status_code == 403
    task = Task.objects.get(pk=task_id)
    assert task.assigned_to_id == org["alice"].id and task.title == "Update employee database"
    # HR cannot act as the assignee either
    hr = client_for(org["hr"])
    assert hr.post(f"/api/tasks/{task_id}/respond/", {"message": "x"}, format="json").status_code == 403


def test_hr_edits_reminds_and_cancels(org, client_for):
    hr = client_for(org["hr"])
    task_id = create(hr, employee_code=org["alice"].employee_code).data["id"]
    res = hr.patch(f"/api/tasks/{task_id}/", {"priority": "URGENT", "assigned_to": org["bob"].id}, format="json")
    assert res.status_code == 200
    assert res.data["priority"] == "URGENT"
    assert res.data["assigned_to"]["id"] == org["alice"].id  # the assignee cannot be changed by an edit
    assert hr.post(f"/api/tasks/{task_id}/remind/").status_code == 200
    assert Notification.objects.filter(recipient=org["alice"].user, type="TASK_REMINDER").exists()
    res = hr.post(f"/api/tasks/{task_id}/cancel/", {"reason": "No longer needed"}, format="json")
    assert res.data["status"] == "CANCELLED" and res.data["cancel_reason"] == "No longer needed"
    assert Notification.objects.filter(recipient=org["alice"].user, type="TASK_CANCELLED").exists()
    assert hr.patch(f"/api/tasks/{task_id}/", {"title": "Late edit"}, format="json").status_code == 409


def test_overdue_is_derived_and_filterable(org, client_for):
    task = Task.objects.create(
        title="Old", assigned_by=org["hr"].user, assigned_to=org["alice"],
        due_date=datetime.datetime(2020, 1, 1, tzinfo=datetime.UTC),
    )
    alice = client_for(org["alice"])
    data = alice.get(f"/api/tasks/{task.id}/").data
    assert data["status"] == "PENDING" and data["display_status"] == "OVERDUE" and data["is_overdue"] is True
    assert [t["id"] for t in alice.get("/api/tasks/", {"status": "OVERDUE"}).data["results"]] == [task.id]
    assert alice.get("/api/tasks/", {"status": "COMPLETED"}).data["results"] == []
    res = create(client_for(org["hr"]), employee_code=org["bob"].employee_code, due_date="2020-01-01")
    assert res.status_code == 400


def test_title_required_and_validation(org, client_for):
    res = create(client_for(org["hr"]), employee_code=org["alice"].employee_code, title="   ")
    assert res.status_code == 400
    res = create(client_for(org["hr"]), employee_code=org["alice"].employee_code, priority="CRITICAL")
    assert res.status_code == 400


def test_anonymous_rejected(anon, org):
    assert anon.get("/api/tasks/").status_code == 401


def test_hr_can_set_start_and_deadline(org, client_for):
    with freeze(FROZEN):
        hr = client_for(org["hr"])
        res = create(hr, employee_code=org["alice"].employee_code,
                     start_date="2025-03-03T18:00:00+05:30", due_date="2025-03-03T19:00:00+05:30")
    assert res.status_code == 201, res.data
    task = Task.objects.get(pk=res.data["id"])
    assert task.start_date is not None and task.due_date is not None
    assert res.data["start_date"] and res.data["due_date"]


def test_deadline_before_start_is_rejected(org, client_for):
    with freeze(FROZEN):
        hr = client_for(org["hr"])
        res = create(hr, employee_code=org["alice"].employee_code,
                     start_date="2025-03-03T19:00:00+05:30", due_date="2025-03-03T18:00:00+05:30")
    assert res.status_code == 400
    assert "due_date" in res.data["error"]["fields"]


def test_deadline_in_past_is_rejected(org, client_for):
    with freeze(FROZEN):
        hr = client_for(org["hr"])
        res = create(hr, employee_code=org["alice"].employee_code, due_date="2020-01-01T10:00:00+05:30")
    assert res.status_code == 400


def test_employee_cannot_edit_timeline(org, client_for):
    with freeze(FROZEN):
        hr = client_for(org["hr"])
        task_id = create(hr, employee_code=org["alice"].employee_code,
                         due_date="2025-03-03T19:00:00+05:30").data["id"]
        alice = client_for(org["alice"])
        res = alice.patch(f"/api/tasks/{task_id}/", {"due_date": "2025-03-04T17:00:00+05:30"}, format="json")
    assert res.status_code == 403
    task = Task.objects.get(pk=task_id)
    assert task.due_date is not None


def test_hr_can_edit_timeline(org, client_for):
    with freeze(FROZEN):
        hr = client_for(org["hr"])
        task_id = create(hr, employee_code=org["alice"].employee_code).data["id"]
        res = hr.patch(f"/api/tasks/{task_id}/", {"due_date": "2025-03-04T17:00:00+05:30",
                                                  "start_date": "2025-03-04T09:00:00+05:30"}, format="json")
    assert res.status_code == 200, res.data
    task = Task.objects.get(pk=task_id)
    assert task.due_date is not None and task.start_date is not None
