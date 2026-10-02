"""Breaks, overtime, task checkout protection and offline synchronisation."""

import datetime
import uuid
from unittest import mock

import pytest

from apps.attendance.models import AttendanceRecord, BreakSession, OvertimeSession, SyncEvent
from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db

UTC = datetime.UTC
DAY = datetime.date(2025, 3, 3)


def at(hour, minute=0, day=DAY):
    return datetime.datetime.combine(day, datetime.time(hour, minute), tzinfo=UTC)


def freeze(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


def post(client, path, moment, data=None):
    with freeze(moment):
        return client.post(path, data or {}, format="json")


def checked_in(client, moment=None):
    res = post(client, "/api/attendance/check-in/", moment or at(9))
    assert res.status_code == 201, res.data
    return res


# --- breaks ----------------------------------------------------------------------------


def test_break_flow_and_actual_working_time(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    res = post(alice, "/api/attendance/breaks/start/", at(12))
    assert res.status_code == 200, res.data
    state = res.data["state"]
    assert state["active_break"]["status"] == "ACTIVE"
    assert state["active_break"]["started_at"].startswith("2025-03-03T12:00")

    res = post(alice, "/api/attendance/breaks/end/", at(12, 30))
    assert res.status_code == 200
    state = res.data["state"]
    assert state["active_break"] is None
    assert state["breaks"][0]["duration_seconds"] == 1800
    assert state["record"]["total_break_seconds"] == 1800

    # a second break the same day
    post(alice, "/api/attendance/breaks/start/", at(15))
    post(alice, "/api/attendance/breaks/end/", at(15, 15))
    res = post(alice, "/api/attendance/check-out/", at(17))
    assert res.status_code == 200
    assert res.data["session_minutes"] == 480
    assert res.data["break_minutes"] == 45
    assert res.data["worked_minutes"] == 435  # 8h - 45m of breaks
    assert BreakSession.objects.filter(employee=org["alice"], status="COMPLETED").count() == 2
    assert AuditLog.objects.filter(action="ATTENDANCE_BREAK_STARTED").count() == 2


def test_break_invalid_states_rejected(org, client_for):
    alice = client_for(org["alice"])
    assert post(alice, "/api/attendance/breaks/start/", at(8)).status_code == 409  # not checked in
    checked_in(alice)
    assert post(alice, "/api/attendance/breaks/end/", at(10)).status_code == 409  # no break to end
    assert post(alice, "/api/attendance/breaks/start/", at(10)).status_code == 200
    res = post(alice, "/api/attendance/breaks/start/", at(10, 5))  # two simultaneous breaks
    assert res.status_code == 409
    assert "already on a break" in res.data["error"]["message"]
    assert BreakSession.objects.filter(employee=org["alice"], status="ACTIVE").count() == 1


def test_break_cannot_overlap_previous_or_precede_check_in(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(10))
    post(alice, "/api/attendance/breaks/end/", at(10, 30))
    # occurred inside the previous break -> conflict, nothing applied
    with freeze(at(11)):
        sync = alice.post(
            "/api/attendance/sync/",
            {"events": [{"id": str(uuid.uuid4()), "type": "BREAK_START", "occurred_at": at(10, 15).isoformat()}]},
            format="json",
        )
    assert sync.data["results"][0]["status"] == "CONFLICT"
    with freeze(at(11)):
        sync = alice.post(
            "/api/attendance/sync/",
            {"events": [{"id": str(uuid.uuid4()), "type": "BREAK_START", "occurred_at": at(8, 30).isoformat()}]},
            format="json",
        )
    assert sync.data["results"][0]["status"] == "CONFLICT"
    assert BreakSession.objects.filter(employee=org["alice"]).count() == 1


def test_check_out_closes_an_open_break(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(16))
    res = post(alice, "/api/attendance/check-out/", at(17))
    assert res.status_code == 200
    assert res.data["break_minutes"] == 60
    assert res.data["worked_minutes"] == 420
    assert not BreakSession.objects.filter(status="ACTIVE").exists()
    assert post(alice, "/api/attendance/breaks/start/", at(17, 5)).status_code == 409  # checked out


def test_break_history_scope(org, client_for):
    for who in ("alice", "carol"):
        client = client_for(org[who])
        checked_in(client)
        post(client, "/api/attendance/breaks/start/", at(12))
        post(client, "/api/attendance/breaks/end/", at(12, 20))
    own = client_for(org["alice"]).get("/api/attendance/breaks/").data["results"]
    assert {b["employee"]["id"] for b in own} == {org["alice"].id}
    team = client_for(org["manager"]).get("/api/attendance/breaks/").data["results"]
    assert {b["employee"]["id"] for b in team} == {org["alice"].id}
    everyone = client_for(org["hr"]).get("/api/attendance/breaks/").data["results"]
    assert {b["employee"]["id"] for b in everyone} == {org["alice"].id, org["carol"].id}


def test_idempotent_online_break_retry(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    event = {"client_event_id": str(uuid.uuid4())}
    first = post(alice, "/api/attendance/breaks/start/", at(12), event)
    retry = post(alice, "/api/attendance/breaks/start/", at(12, 1), event)  # network retry of the same click
    assert first.status_code == retry.status_code == 200
    assert retry.data["duplicate"] is True
    assert BreakSession.objects.filter(employee=org["alice"]).count() == 1


# --- overtime --------------------------------------------------------------------------


def test_overtime_flow_is_separate_from_attendance(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    assert post(alice, "/api/attendance/overtime/start/", at(16)).status_code == 409  # before normal check-out
    post(alice, "/api/attendance/check-out/", at(17))
    res = post(alice, "/api/attendance/overtime/start/", at(17, 30))
    assert res.status_code == 200, res.data
    assert res.data["state"]["active_overtime"]["status"] == "ACTIVE"
    assert Notification.objects.filter(recipient=org["manager"].user, type="OVERTIME_STARTED").exists()
    assert post(alice, "/api/attendance/overtime/start/", at(17, 40)).status_code == 409  # duplicate

    res = post(alice, "/api/attendance/overtime/end/", at(19, 45))
    assert res.status_code == 200
    overtime = res.data["state"]["overtime"][0]
    assert overtime["duration_seconds"] == 2 * 3600 + 15 * 60
    assert overtime["status"] == "COMPLETED"
    assert Notification.objects.filter(recipient=org["manager"].user, type="OVERTIME_COMPLETED").exists()
    assert AuditLog.objects.filter(action="OVERTIME_COMPLETED").exists()
    # normal attendance is unchanged by overtime
    assert AttendanceRecord.objects.get(employee=org["alice"]).worked_minutes == 480
    assert post(alice, "/api/attendance/overtime/end/", at(19, 50)).status_code == 409  # nothing running


def test_overtime_cannot_overlap_previous(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    post(alice, "/api/attendance/check-out/", at(17))
    post(alice, "/api/attendance/overtime/start/", at(17, 10))
    post(alice, "/api/attendance/overtime/end/", at(18))
    with freeze(at(19)):
        res = alice.post(
            "/api/attendance/sync/",
            {"events": [{"id": str(uuid.uuid4()), "type": "OVERTIME_START", "occurred_at": at(17, 30).isoformat()}]},
            format="json",
        )
    assert res.data["results"][0]["status"] == "CONFLICT"
    assert OvertimeSession.objects.filter(employee=org["alice"]).count() == 1


def test_overtime_visibility_by_role(org, client_for):
    for who in ("alice", "carol"):
        client = client_for(org[who])
        checked_in(client)
        post(client, "/api/attendance/check-out/", at(17))
        post(client, "/api/attendance/overtime/start/", at(17, 5))
        post(client, "/api/attendance/overtime/end/", at(18))

    def ids(who):
        rows = client_for(org[who]).get("/api/attendance/overtime/").data["results"]
        return {o["employee"]["id"] for o in rows}

    assert ids("alice") == {org["alice"].id}
    assert ids("bob") == set()
    assert ids("manager") == {org["alice"].id}
    assert ids("hr") == ids("super_admin") == {org["alice"].id, org["carol"].id}
    carol_ot = OvertimeSession.objects.get(employee=org["carol"])
    assert client_for(org["manager"]).get(f"/api/attendance/overtime/{carol_ot.id}/").status_code == 404


def test_all_roles_can_use_breaks_and_overtime(org, client_for):
    for who in ("super_admin", "hr", "manager", "alice"):
        client = client_for(org[who])
        checked_in(client)
        assert post(client, "/api/attendance/breaks/start/", at(12)).status_code == 200
        assert post(client, "/api/attendance/breaks/end/", at(12, 10)).status_code == 200
        assert post(client, "/api/attendance/check-out/", at(17)).status_code == 200
        assert post(client, "/api/attendance/overtime/start/", at(17, 1)).status_code == 200
        assert post(client, "/api/attendance/overtime/end/", at(17, 31)).status_code == 200


def test_self_attendance_disabled_blocks_breaks(org, client_for, configure):
    alice = client_for(org["alice"])
    checked_in(alice)
    configure(self_attendance_enabled=False)
    assert post(alice, "/api/attendance/breaks/start/", at(12)).status_code == 403
    res = post(alice, "/api/attendance/breaks/start/", at(12), {"client_event_id": str(uuid.uuid4())})
    assert res.status_code == 403


# --- task checkout protection ------------------------------------------------------------


def make_task(org, assignee, **fields):
    return Task.objects.create(title="Update employee database", assigned_by=org["hr"].user, assigned_to=assignee,
                               **fields)


def test_pending_task_blocks_checkout_until_response(org, client_for):
    alice = client_for(org["alice"])
    task = make_task(org, org["alice"])
    checked_in(alice)
    state = alice.get("/api/attendance/today/")
    res = post(alice, "/api/attendance/check-out/", at(17))
    assert res.status_code == 409
    assert res.data["error"]["code"] == "checkout_blocked_by_tasks"
    assert AttendanceRecord.objects.get(employee=org["alice"]).check_out is None
    assert state.status_code == 200

    blocking = alice.get("/api/tasks/blocking/").data
    assert blocking["count"] == 1 and blocking["results"][0]["id"] == task.id
    assert alice.post(f"/api/tasks/{task.id}/respond/", {"message": "Done, updated."}, format="json").status_code == 200
    assert alice.get("/api/tasks/blocking/").data["count"] == 0
    assert post(alice, "/api/attendance/check-out/", at(17, 1)).status_code == 200


@pytest.mark.parametrize("status", ["COMPLETED", "CANCELLED"])
def test_closed_tasks_do_not_block(org, client_for, status):
    from django.utils import timezone

    stamp = {"completed_at": timezone.now()} if status == "COMPLETED" else {"cancelled_at": timezone.now()}
    make_task(org, org["alice"], status=status, **stamp)
    make_task(org, org["alice"], requires_response=False)  # non-blocking by HR's choice
    alice = client_for(org["alice"])
    checked_in(alice)
    assert post(alice, "/api/attendance/check-out/", at(17)).status_code == 200


def test_rule_applies_to_hr_and_manager_but_not_super_admin(org, client_for):
    for who, expected in (("hr", 409), ("manager", 409), ("super_admin", 200)):
        Task.objects.create(title="Check", assigned_by=org["super_admin"].user if who == "hr" else org["hr"].user,
                            assigned_to=org[who])
        client = client_for(org[who])
        checked_in(client)
        assert post(client, "/api/attendance/check-out/", at(17)).status_code == expected, who


def test_other_peoples_tasks_do_not_block_and_cannot_be_answered(org, client_for):
    task = make_task(org, org["bob"])
    alice = client_for(org["alice"])
    checked_in(alice)
    assert alice.post(f"/api/tasks/{task.id}/respond/", {"message": "x"}, format="json").status_code == 404
    assert post(alice, "/api/attendance/check-out/", at(17)).status_code == 200


# --- offline synchronisation -----------------------------------------------------------


def sync(client, events, now):
    with freeze(now):
        return client.post("/api/attendance/sync/", {"events": events}, format="json")


def ev(kind, moment, event_id=None):
    return {"id": event_id or str(uuid.uuid4()), "type": kind, "occurred_at": moment.isoformat()}


def test_offline_events_sync_with_device_times(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    events = [ev("BREAK_END", at(13, 20)), ev("BREAK_START", at(13))]  # out of order on purpose
    res = sync(alice, events, at(14))
    assert res.status_code == 200
    assert [r["status"] for r in res.data["results"]] == ["APPLIED", "APPLIED"]
    session = BreakSession.objects.get(employee=org["alice"])
    assert session.duration_seconds == 20 * 60
    assert session.source == "OFFLINE"
    assert res.data["state"]["record"]["total_break_seconds"] == 1200
    assert SyncEvent.objects.filter(user=org["alice"].user, channel="OFFLINE", status="APPLIED").count() == 2


def test_sync_is_idempotent_on_retry(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    events = [ev("BREAK_START", at(13)), ev("BREAK_END", at(13, 10))]
    first = sync(alice, events, at(14))
    again = sync(alice, events, at(14, 5))  # e.g. response lost, client retries
    assert [r["duplicate"] for r in again.data["results"]] == [True, True]
    assert [r["status"] for r in again.data["results"]] == [r["status"] for r in first.data["results"]]
    assert BreakSession.objects.filter(employee=org["alice"]).count() == 1
    assert AttendanceRecord.objects.get(employee=org["alice"]).total_break_seconds == 600


def test_sync_conflicts_and_rejections_are_reported_not_applied(org, client_for):
    alice = client_for(org["alice"])
    checked_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(12))  # started online meanwhile (another device)
    res = sync(
        alice,
        [
            ev("BREAK_START", at(12, 5)),  # conflict: already on a break
            ev("OVERTIME_END", at(12, 6)),  # conflict: nothing running
            ev("BREAK_END", at(23, 59)),  # rejected: in the future
            ev("BREAK_END", at(9, 0, DAY - datetime.timedelta(days=3))),  # rejected: too old
        ],
        at(12, 10),
    )
    statuses = {r["type"] + r["status"] for r in res.data["results"]}
    assert statuses == {"BREAK_STARTCONFLICT", "OVERTIME_ENDCONFLICT", "BREAK_ENDREJECTED"}
    assert all(r["error"] for r in res.data["results"])
    assert BreakSession.objects.get(employee=org["alice"]).status == "ACTIVE"
    assert Notification.objects.filter(recipient=org["alice"].user, type="SYNC_STATUS").exists()
    assert AuditLog.objects.filter(action="OFFLINE_SYNC_CONFLICT").count() == 2


def test_sync_validation_and_permissions(org, client_for, make_user):
    alice = client_for(org["alice"])
    same = str(uuid.uuid4())
    events = [ev("BREAK_START", at(9), same), ev("BREAK_END", at(9), same)]
    res = alice.post("/api/attendance/sync/", {"events": events}, format="json")
    assert res.status_code == 400
    res = alice.post("/api/attendance/sync/", {"events": [{"id": "x", "type": "HACK", "occurred_at": "nope"}]},
                     format="json")
    assert res.status_code == 400
    no_employee = client_for(make_user())
    assert no_employee.post("/api/attendance/sync/", {"events": []}, format="json").status_code == 403


def test_sync_events_are_per_user(org, client_for):
    """The same client id from another user is a different event (ids are scoped per user)."""
    shared = str(uuid.uuid4())
    for who in ("alice", "bob"):
        client = client_for(org[who])
        checked_in(client)
        res = sync(client, [ev("BREAK_START", at(12), shared)], at(12, 5))
        assert res.data["results"][0]["status"] == "APPLIED"
    log = client_for(org["alice"]).get("/api/attendance/sync-events/").data["results"]
    assert {e["employee"]["id"] for e in log} == {org["alice"].id}
    assert len(client_for(org["hr"]).get("/api/attendance/sync-events/", {"channel": "OFFLINE"}).data["results"]) == 2


def test_today_state_for_session_recovery(org, client_for):
    alice = client_for(org["alice"])
    with freeze(at(10)):
        assert alice.get("/api/attendance/today/").data["record"] is None
    checked_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(11))
    with freeze(at(11, 30)):
        state = alice.get("/api/attendance/today/").data
    assert state["record"]["check_in"].startswith("2025-03-03T09:00")
    assert state["active_break"]["started_at"].startswith("2025-03-03T11:00")
    assert state["server_time"].startswith("2025-03-03T11:30")
    assert state["checkout_exempt"] is False
    # duplicate sessions are impossible: a second check-in is refused
    assert post(alice, "/api/attendance/check-in/", at(11, 31)).status_code == 409
