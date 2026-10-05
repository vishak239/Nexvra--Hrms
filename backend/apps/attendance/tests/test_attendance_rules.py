"""Geofence, work from home, break allowance, inactivity and the overtime workflow."""

import datetime
import math
import smtplib
import uuid
from unittest import mock

import pytest
from django.core import mail
from django.core.management import call_command

from apps.attendance import geo
from apps.attendance.models import AttendanceRecord, BreakSession, OvertimeSession, WorkFromHomeRequest
from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db

UTC = datetime.UTC
DAY = datetime.date(2025, 3, 3)
WORK = (12.9716, 77.5946)  # test workplace


def at(hour, minute=0, second=0, day=DAY):
    return datetime.datetime.combine(day, datetime.time(hour, minute, second), tzinfo=UTC)


def freeze(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


def post(client, path, moment, data=None):
    with freeze(moment):
        return client.post(path, data or {}, format="json")


def get(client, path, moment):
    with freeze(moment):
        return client.get(path)


def north(metres):
    """A point `metres` due north of the workplace (exact for the haversine formula)."""
    return {"latitude": WORK[0] + math.degrees(metres / geo.EARTH_RADIUS_M), "longitude": WORK[1]}


def here(metres=0, accuracy=10):
    return {**north(metres), "accuracy": accuracy}


@pytest.fixture
def workplace(configure):
    return configure(workplace_latitude=WORK[0], workplace_longitude=WORK[1], geofence_radius_m=20,
                     geofence_max_accuracy_m=100)


def office_check_in(client, moment=None, metres=5):
    res = post(client, "/api/attendance/check-in/", moment or at(9), here(metres))
    assert res.status_code == 201, res.data
    return res


def record(org, who="alice"):
    return AttendanceRecord.objects.get(employee=org[who])


# --- geofence maths --------------------------------------------------------------------


def test_haversine_matches_known_distance():
    # Bengaluru (12.9716, 77.5946) -> Chennai (13.0827, 80.2707): about 290 km
    assert 289_000 < geo.haversine_m(12.9716, 77.5946, 13.0827, 80.2707) < 292_000
    assert geo.haversine_m(*WORK, north(37)["latitude"], WORK[1]) == pytest.approx(37, abs=1e-6)


def test_boundary_and_exit_rules_are_consistent():
    assert geo.within_radius(20.0, 20) is True  # the boundary counts as inside
    assert geo.within_radius(20.0001, 20) is False
    assert geo.has_clearly_left(35, 10, 20) is True
    assert geo.has_clearly_left(25, 10, 20) is False  # could still be inside: never checked out


# --- geofence check-in -----------------------------------------------------------------


@pytest.mark.parametrize("metres", [5, 19, 19.99])
def test_office_check_in_allowed_inside_the_radius(org, client_for, workplace, metres):
    res = post(client_for(org["alice"]), "/api/attendance/check-in/", at(9), here(metres))
    assert res.status_code == 201, res.data
    assert res.data["mode"] == "OFFICE"
    assert res.data["check_in_distance_m"] == round(metres)
    assert "check_in_latitude" not in res.data  # coordinates are never exposed by the API
    rec = record(org)
    assert rec.check_in_latitude is not None and rec.check_in_accuracy_m == 10


@pytest.mark.parametrize("metres", [21, 100])
def test_office_check_in_rejected_outside_the_radius(org, client_for, workplace, metres):
    res = post(client_for(org["alice"]), "/api/attendance/check-in/", at(9), here(metres))
    assert res.status_code == 403
    assert res.data["error"]["code"] == "outside_geofence"
    assert f"about {metres} m away" in res.data["error"]["message"]
    assert not AttendanceRecord.objects.filter(employee=org["alice"]).exists()


def test_forged_client_flags_are_ignored(org, client_for, workplace):
    forged = {**here(150), "inside_radius": True, "distance": 0, "distance_m": 0, "within_geofence": True}
    res = post(client_for(org["alice"]), "/api/attendance/check-in/", at(9), forged)
    assert res.status_code == 403 and res.data["error"]["code"] == "outside_geofence"


def test_missing_or_imprecise_location_is_rejected_safely(org, client_for, workplace):
    alice = client_for(org["alice"])
    res = post(alice, "/api/attendance/check-in/", at(9), {"inside_radius": True})
    assert res.status_code == 400 and res.data["error"]["code"] == "location_required"
    res = post(alice, "/api/attendance/check-in/", at(9), {**north(2), "accuracy": 500})
    assert res.status_code == 400 and res.data["error"]["code"] == "location_too_imprecise"
    res = post(alice, "/api/attendance/check-in/", at(9), {"latitude": 12.9716})
    assert res.status_code == 400  # latitude without longitude
    res = post(alice, "/api/attendance/check-in/", at(9), {"latitude": 123, "longitude": 1, "accuracy": 5})
    assert res.status_code == 400  # impossible coordinates
    assert not AttendanceRecord.objects.filter(employee=org["alice"]).exists()


def test_without_a_configured_workplace_the_geofence_is_not_applied(org, client_for):
    res = post(client_for(org["alice"]), "/api/attendance/check-in/", at(9))
    assert res.status_code == 201
    assert res.data["check_in_distance_m"] is None


# --- geofence exit (automatic check-out) ------------------------------------------------


def heartbeat(client, moment, idle=0, **location):
    data = {"idle_seconds": idle, **({"location_status": "ok", **location} if location else {})}
    return post(client, "/api/attendance/heartbeat/", moment, data)


def test_leaving_the_workplace_checks_out_once(org, client_for, workplace):
    alice = client_for(org["alice"])
    office_check_in(alice)
    assert heartbeat(alice, at(10), **here(25, accuracy=10)).data["changed"] is False  # jitter near boundary
    assert record(org).check_out is None
    res = heartbeat(alice, at(10, 5), **here(120, accuracy=10))
    assert res.status_code == 200 and res.data["changed"] is True
    rec = record(org)
    assert rec.check_out == at(10, 5)
    assert rec.checkout_reason == "GEO_FENCE_EXIT"
    assert rec.check_out_distance_m == 120 and rec.check_out_latitude is not None
    assert res.data["state"]["record"]["checkout_reason"] == "GEO_FENCE_EXIT"
    # repeated reports never create a second check-out
    heartbeat(alice, at(10, 7), **here(300))
    assert AuditLog.objects.filter(action="ATTENDANCE_AUTO_CHECKOUT").count() == 1
    assert record(org).check_out == at(10, 5)
    assert Notification.objects.filter(recipient=org["alice"].user, type="ATTENDANCE_AUTO_CHECKOUT").count() == 1


def test_unavailable_location_is_recorded_not_treated_as_leaving(org, client_for, workplace):
    alice = client_for(org["alice"])
    office_check_in(alice)
    for minute in (5, 7, 9):
        post(alice, "/api/attendance/heartbeat/", at(9, minute), {"idle_seconds": 0, "location_status": "denied"})
    rec = record(org)
    assert rec.check_out is None
    assert rec.location_issue == "DENIED"
    assert AuditLog.objects.filter(action="ATTENDANCE_LOCATION_UNAVAILABLE").count() == 1  # once, not per report
    heartbeat(alice, at(9, 10), **here(400, accuracy=900))  # imprecise reading: no check-out either
    assert record(org).check_out is None and record(org).location_issue == "LOW_ACCURACY"


def test_no_geofence_exit_during_a_break(org, client_for, workplace):
    alice = client_for(org["alice"])
    office_check_in(alice)
    heartbeat(alice, at(11, 59), **here(5))
    post(alice, "/api/attendance/breaks/start/", at(12))
    heartbeat(alice, at(12, 10), **here(800))  # lunch outside the office
    assert record(org).check_out is None


# --- work from home --------------------------------------------------------------------


def wfh_request(client, moment=None, day=DAY, reason="Plumber visit at home"):
    return post(client, "/api/attendance/wfh/", moment or at(8), {"date": day.isoformat(), "reason": reason})


def decide(org, request_id, approve=True, who="hr", moment=None):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_login(org[who].user)
    action = "approve" if approve else "reject"
    return post(client, f"/api/attendance/wfh/{request_id}/{action}/", moment or at(8, 30), {"note": "OK"})


def wfh_check_in(client, moment=None):
    return post(client, "/api/attendance/check-in/", moment or at(9), {"mode": "WORK_FROM_HOME", **here(5000)})


def test_wfh_needs_an_approved_request(org, client_for, workplace, no_inactivity, django_capture_on_commit_callbacks):
    alice = client_for(org["alice"])
    assert wfh_check_in(alice).data["error"]["code"] == "wfh_not_approved"  # no request
    res = wfh_request(alice)
    assert res.status_code == 201 and res.data["status"] == "PENDING"
    assert Notification.objects.filter(recipient=org["hr"].user, type="WFH_REQUESTED").exists()
    assert wfh_check_in(alice).status_code == 403  # pending

    with django_capture_on_commit_callbacks(execute=True):
        assert decide(org, res.data["id"]).status_code == 200
    assert len(mail.outbox) == 1 and "approved" in mail.outbox[0].subject
    checked = wfh_check_in(alice)
    assert checked.status_code == 201, checked.data
    assert checked.data["mode"] == "WORK_FROM_HOME"
    rec = record(org)
    assert rec.wfh_request_id == res.data["id"]
    assert rec.check_in_latitude is None  # no home location is collected
    log = AuditLog.objects.get(action="ATTENDANCE_CHECK_IN")
    assert log.metadata["mode"] == "WORK_FROM_HOME"
    # the geofence does not apply to a WFH session
    heartbeat(alice, at(10), **here(9000))
    assert record(org).check_out is None
    assert post(alice, "/api/attendance/check-out/", at(17)).status_code == 200


def test_rejected_and_expired_approvals_do_not_allow_wfh(org, client_for, workplace):
    alice = client_for(org["alice"])
    rejected = wfh_request(alice).data["id"]
    assert decide(org, rejected, approve=False).status_code == 200
    assert wfh_check_in(alice).status_code == 403
    # approved for yesterday: expired today
    yesterday = DAY - datetime.timedelta(days=1)
    old = wfh_request(alice, moment=at(8, day=yesterday), day=yesterday).data["id"]
    decide(org, old, moment=at(8, 30, day=yesterday))
    assert wfh_check_in(alice).data["error"]["code"] == "wfh_not_approved"


def test_wfh_approval_belongs_to_one_employee(org, client_for, workplace):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    rid = wfh_request(alice).data["id"]
    decide(org, rid)
    assert wfh_check_in(bob).data["error"]["code"] == "wfh_not_approved"  # Alice's approval is not Bob's
    assert post(bob, f"/api/attendance/wfh/{rid}/cancel/", at(8)).status_code == 404  # not visible to Bob
    assert post(bob, f"/api/attendance/wfh/{rid}/approve/", at(8)).status_code == 403
    manager = client_for(org["manager"])
    assert post(manager, f"/api/attendance/wfh/{rid}/approve/", at(8)).status_code == 403  # HR / SA only


def test_wfh_decisions_rules(org, client_for):
    hr = client_for(org["hr"])
    own = wfh_request(hr).data["id"]
    assert decide(org, own, who="hr").status_code == 403  # nobody decides their own request
    assert decide(org, own, who="super_admin").status_code == 200
    assert decide(org, own, who="super_admin").status_code == 409  # already decided
    alice = client_for(org["alice"])
    assert wfh_request(alice, day=DAY - datetime.timedelta(days=1)).status_code == 400  # past date
    assert wfh_request(alice, reason="x").status_code == 400
    first = wfh_request(alice).data["id"]
    assert wfh_request(alice).status_code == 409  # one open request per day
    assert post(alice, f"/api/attendance/wfh/{first}/cancel/", at(8, 10)).status_code == 200
    assert AuditLog.objects.filter(action="WFH_CANCELLED").exists()


def test_wfh_list_scope(org, client_for):
    for who in ("alice", "carol"):
        wfh_request(client_for(org[who]))

    def employees(who):
        return {r["employee"]["id"] for r in client_for(org[who]).get("/api/attendance/wfh/").data["results"]}

    assert employees("alice") == {org["alice"].id}
    assert employees("manager") == {org["alice"].id}
    assert employees("hr") == {org["alice"].id, org["carol"].id}


# --- break allowance -------------------------------------------------------------------


def take_break(client, start, minutes):
    assert post(client, "/api/attendance/breaks/start/", start).status_code == 200
    end = start + datetime.timedelta(minutes=minutes)
    res = post(client, "/api/attendance/breaks/end/", end)
    assert res.status_code == 200, res.data
    return res


@pytest.fixture
def no_inactivity(configure):
    configure(inactivity_timeout_minutes=None)


def test_breaks_add_up_to_the_daily_allowance(org, client_for, no_inactivity):
    alice = client_for(org["alice"])
    office_check_in(alice)
    take_break(alice, at(11), 15)
    take_break(alice, at(13), 20)
    res = take_break(alice, at(15), 25)
    state = res.data["state"]
    assert state["break_used_seconds"] == 3600 and state["break_remaining_seconds"] == 0
    blocked = post(alice, "/api/attendance/breaks/start/", at(16))
    assert blocked.status_code == 409 and "60-minute break allowance" in blocked.data["error"]["message"]
    assert record(org).total_break_seconds == 3600


def test_a_running_break_stops_at_the_allowance(org, client_for, no_inactivity):
    alice = client_for(org["alice"])
    office_check_in(alice)
    take_break(alice, at(11), 50)
    post(alice, "/api/attendance/breaks/start/", at(13))
    during = get(alice, "/api/attendance/today/", at(13, 5)).data  # refresh during the break
    assert during["active_break"] is not None
    assert during["break_used_seconds"] == 55 * 60 and during["break_remaining_seconds"] == 5 * 60
    later = get(alice, "/api/attendance/today/", at(13, 30)).data  # 61+ minutes would be over the limit
    assert later["active_break"] is None
    session = BreakSession.objects.get(employee=org["alice"], started_at=at(13))
    assert session.ended_at == at(13, 10) and session.end_reason == "ALLOWANCE_EXHAUSTED"
    assert record(org).total_break_seconds == 3600  # never more than the allowance


def test_ending_a_break_late_is_capped_at_the_allowance(org, client_for, no_inactivity):
    alice = client_for(org["alice"])
    office_check_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(12))
    with freeze(at(13, 1)):  # clicked "Back to work" after 61 minutes, before any reconciliation
        from apps.attendance import sessions

        request = mock.Mock(user=org["alice"].user, META={})
        sessions.end_break(request)
    session = BreakSession.objects.get(employee=org["alice"])
    assert session.duration_seconds == 3600 and session.end_reason == "ALLOWANCE_EXHAUSTED"


def test_back_to_work_after_the_allowance_closed_the_break(org, client_for, no_inactivity):
    alice = client_for(org["alice"])
    office_check_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(12))
    get(alice, "/api/attendance/today/", at(13, 5))  # the allowance closed the break at 13:00
    res = post(alice, "/api/attendance/breaks/end/", at(13, 6))
    assert res.status_code == 200
    assert record(org).total_break_seconds == 3600 and record(org).last_activity_at == at(13, 6)


def test_active_break_cannot_start_twice_and_survives_logout(org, client_for, no_inactivity):
    alice = client_for(org["alice"])
    office_check_in(alice)
    post(alice, "/api/attendance/breaks/start/", at(12))
    assert post(alice, "/api/attendance/breaks/start/", at(12, 1)).status_code == 409
    alice.logout()
    again = client_for(org["alice"])
    assert get(again, "/api/attendance/today/", at(12, 20)).data["active_break"] is not None


def test_automatic_check_out_during_a_break(org, client_for):
    """The inactivity clock starts when the break allowance runs out."""
    alice = client_for(org["alice"])
    office_check_in(alice)
    heartbeat(alice, at(11, 59))
    post(alice, "/api/attendance/breaks/start/", at(12))
    assert get(alice, "/api/attendance/today/", at(13, 29)).data["record"]["check_out"] is None
    # The deadline (13:30) has passed, but nothing confirms it yet: a silent browser gets a grace.
    assert get(alice, "/api/attendance/today/", at(13, 31)).data["record"]["check_out"] is None
    state = heartbeat(alice, at(13, 31), idle=5520).data["state"]  # the open browser saw no activity
    rec = record(org)
    assert rec.check_out == at(13, 30) and rec.checkout_reason == "INACTIVITY_TIMEOUT"
    assert rec.total_break_seconds == 3600
    assert state["active_break"] is None


# --- inactivity --------------------------------------------------------------------------


def test_activity_resets_the_inactivity_timer(org, client_for):
    alice = client_for(org["alice"])
    office_check_in(alice)
    heartbeat(alice, at(9, 25), idle=60)  # active at 9:24
    heartbeat(alice, at(9, 50), idle=1500)  # last interaction still 9:25 -> deadline 9:55
    assert record(org).check_out is None
    assert record(org).last_activity_at == at(9, 25)


def test_exactly_thirty_minutes_of_inactivity_checks_out(org, client_for):
    alice = client_for(org["alice"])
    office_check_in(alice)
    heartbeat(alice, at(9, 29, 59), idle=1799)
    assert record(org).check_out is None
    res = heartbeat(alice, at(9, 30), idle=1800)
    rec = record(org)
    assert res.data["changed"] is True
    assert rec.check_out == at(9, 30) and rec.checkout_reason == "INACTIVITY_TIMEOUT"
    log = AuditLog.objects.get(action="ATTENDANCE_AUTO_CHECKOUT")
    assert log.metadata["reason"] == "INACTIVITY_TIMEOUT"
    assert log.metadata["last_activity_at"].startswith("2025-03-03T09:00")
    # repeated reconciliation, a refresh and later reports never check out twice
    get(alice, "/api/attendance/today/", at(10))
    heartbeat(alice, at(10, 5))
    with freeze(at(11)):
        call_command("reconcile_attendance", stdout=mock.Mock())
    assert AuditLog.objects.filter(action="ATTENDANCE_AUTO_CHECKOUT").count() == 1
    assert record(org).check_out == at(9, 30)


def test_lost_connection_is_settled_by_the_scheduled_reconciliation(org, client_for):
    alice = client_for(org["alice"])
    office_check_in(alice)
    heartbeat(alice, at(10))  # last report, then the browser is closed / offline
    with freeze(at(10, 29)):
        call_command("reconcile_attendance", stdout=mock.Mock())
    assert record(org).check_out is None
    with freeze(at(12)):
        call_command("reconcile_attendance", stdout=mock.Mock())
    rec = record(org)
    assert rec.check_out == at(10, 30)  # last confirmed activity + 30 min, never later
    assert rec.checkout_reason == "INACTIVITY_TIMEOUT"


def test_idle_report_cannot_move_activity_backwards_or_before_check_in(org, client_for):
    alice = client_for(org["alice"])
    office_check_in(alice)
    heartbeat(alice, at(9, 20))
    heartbeat(alice, at(9, 21), idle=3600)  # claims long idleness: stored activity stays at 9:20
    assert record(org).last_activity_at == at(9, 20)
    bob = client_for(org["bob"])
    office_check_in(bob, at(9, 40))
    heartbeat(bob, at(9, 41), idle=86400)
    assert record(org, "bob").last_activity_at == at(9, 40)


def test_manual_actions_respect_an_overdue_inactivity_check_out(org, client_for):
    alice = client_for(org["alice"])
    office_check_in(alice)
    res = post(alice, "/api/attendance/check-out/", at(17))  # idle since 9:00, no reconciliation ran
    assert res.status_code == 409
    rec = record(org)
    assert rec.check_out == at(9, 30) and rec.checkout_reason == "INACTIVITY_TIMEOUT"


def test_heartbeat_needs_self_attendance(org, client_for, configure):
    configure(self_attendance_enabled=False)
    res = post(client_for(org["alice"]), "/api/attendance/heartbeat/", at(9), {"idle_seconds": 0})
    assert res.status_code == 403
    assert post(client_for(org["alice"]), "/api/attendance/heartbeat/", at(9), {}).status_code in (400, 403)


# --- overtime workflow --------------------------------------------------------------------


DECLARE = {"work_description": "Complete API integration for the attendance module.", "declaration_confirmed": True}


def make_task(org, who="alice", **fields):
    return Task.objects.create(title="Attendance API", assigned_by=org["hr"].user, assigned_to=org[who], **fields)


def after_checkout(client):
    office_check_in(client)
    assert post(client, "/api/attendance/check-out/", at(9, 20)).status_code == 200


@pytest.mark.parametrize(
    "payload, field",
    [
        ({**DECLARE}, "task_ids"),  # neither a task nor another reason
        ({**DECLARE, "use_other_reason": True, "other_reason": "short"}, "other_reason"),
        ({**DECLARE, "use_other_reason": True, "other_reason": "Customer outage follow-up", "work_description": ""},
         "work_description"),
        ({**DECLARE, "use_other_reason": True, "other_reason": "Customer outage follow-up",
          "declaration_confirmed": False}, "declaration_confirmed"),
    ],
)
def test_overtime_declaration_is_validated(org, client_for, payload, field):
    alice = client_for(org["alice"])
    after_checkout(alice)
    res = post(alice, "/api/attendance/overtime/request/", at(9, 25), payload)
    assert res.status_code == 400
    assert field in res.data["error"]["fields"]
    assert not OvertimeSession.objects.exists()


def test_overtime_tasks_must_be_own_open_tasks(org, client_for):
    alice = client_for(org["alice"])
    after_checkout(alice)
    bobs = make_task(org, "bob")
    from django.utils import timezone

    done = make_task(org, status=Task.Status.COMPLETED, completed_at=timezone.now())
    for task in (bobs, done):
        res = post(alice, "/api/attendance/overtime/request/", at(9, 25), {**DECLARE, "task_ids": [task.id]})
        assert res.status_code == 400 and "task_ids" in res.data["error"]["fields"]


def test_overtime_request_approval_start_and_end(org, client_for, django_capture_on_commit_callbacks):
    alice = client_for(org["alice"])
    after_checkout(alice)
    task = make_task(org)
    payload = {**DECLARE, "task_ids": [task.id], "status": "ACTIVE", "started_at": "2020-01-01T00:00:00Z"}
    res = post(alice, "/api/attendance/overtime/request/", at(9, 25), payload)
    assert res.status_code == 201, res.data
    req = res.data["state"]["open_overtime_request"]
    assert req["status"] == "REQUESTED" and req["started_at"] is None  # client cannot set status / times
    assert [t["id"] for t in req["tasks"]] == [task.id]
    assert Notification.objects.filter(recipient=org["hr"].user, type="OVERTIME_REQUESTED").exists()
    assert post(alice, "/api/attendance/overtime/start/", at(9, 26)).status_code == 409  # not approved yet
    assert post(alice, f"/api/attendance/overtime/{req['id']}/approve/", at(9, 26)).status_code == 403
    assert post(client_for(org["manager"]), f"/api/attendance/overtime/{req['id']}/approve/", at(9, 26)).status_code \
        == 403

    with django_capture_on_commit_callbacks(execute=True):
        approved = post(client_for(org["hr"]), f"/api/attendance/overtime/{req['id']}/approve/", at(9, 27))
    assert approved.status_code == 200 and approved.data["status"] == "APPROVED"
    assert approved.data["decided_by_name"] == org["hr"].user.full_name
    assert any("overtime" in m.subject.lower() for m in mail.outbox)

    started = post(alice, "/api/attendance/overtime/start/", at(9, 30))
    assert started.status_code == 200 and started.data["state"]["active_overtime"]["status"] == "ACTIVE"
    heartbeat(alice, at(9, 50))
    ended = post(alice, "/api/attendance/overtime/end/", at(10))
    assert ended.status_code == 200
    session = OvertimeSession.objects.get(pk=req["id"])
    assert session.status == "COMPLETED" and session.duration_seconds == 1800 and session.end_reason == "MANUAL"
    for action in ("OVERTIME_REQUESTED", "OVERTIME_APPROVED", "OVERTIME_STARTED", "OVERTIME_COMPLETED"):
        assert AuditLog.objects.filter(action=action, entity_id=str(session.id)).exists(), action


def test_rejected_overtime_cannot_start(org, client_for):
    alice = client_for(org["alice"])
    after_checkout(alice)
    rid = post(alice, "/api/attendance/overtime/request/", at(9, 25), {**DECLARE, "use_other_reason": True,
               "other_reason": "Quarter-end report for finance"}).data["state"]["open_overtime_request"]["id"]
    res = post(client_for(org["hr"]), f"/api/attendance/overtime/{rid}/reject/", at(9, 26), {"note": "Not needed"})
    assert res.status_code == 200 and res.data["status"] == "REJECTED"
    assert post(alice, "/api/attendance/overtime/start/", at(9, 27)).status_code == 409
    assert Notification.objects.filter(recipient=org["alice"].user, type="OVERTIME_REJECTED").exists()


def test_overtime_stops_after_thirty_minutes_without_activity(org, client_for):
    alice = client_for(org["alice"])
    after_checkout(alice)
    rid = post(alice, "/api/attendance/overtime/request/", at(9, 25), {**DECLARE, "task_ids": [make_task(org).id]}
               ).data["state"]["open_overtime_request"]["id"]
    post(client_for(org["hr"]), f"/api/attendance/overtime/{rid}/approve/", at(9, 26))
    post(alice, "/api/attendance/overtime/start/", at(10))
    heartbeat(alice, at(10, 20))  # active at 10:20
    get(alice, "/api/attendance/today/", at(10, 49))
    assert OvertimeSession.objects.get(pk=rid).status == "ACTIVE"
    state = get(alice, "/api/attendance/today/", at(10, 50)).data
    session = OvertimeSession.objects.get(pk=rid)
    assert session.status == "AUTO_STOPPED" and session.end_reason == "OVERTIME_INACTIVITY_TIMEOUT"
    assert session.ended_at == at(10, 50) and session.duration_seconds == 50 * 60
    assert state["active_overtime"] is None
    assert AuditLog.objects.filter(action="OVERTIME_AUTO_STOPPED").count() == 1
    # continuing needs a new declaration and a new approval: never a silent restart
    assert post(alice, "/api/attendance/overtime/start/", at(10, 55)).status_code == 409
    again = post(alice, "/api/attendance/overtime/request/", at(10, 56), {**DECLARE, "use_other_reason": True,
                 "other_reason": "Finish the remaining integration tests"})
    assert again.status_code == 201
    assert again.data["state"]["open_overtime_request"]["id"] != rid


def test_overtime_without_approval_policy_starts_on_declaration(org, client_for, configure):
    configure(overtime_requires_approval=False)
    alice = client_for(org["alice"])
    after_checkout(alice)
    res = post(alice, "/api/attendance/overtime/request/", at(9, 25), {**DECLARE, "use_other_reason": True,
               "other_reason": "Production incident follow-up work"})
    assert res.status_code == 201
    assert res.data["state"]["active_overtime"]["status"] == "ACTIVE"
    assert res.data["state"]["active_overtime"]["work_description"] == DECLARE["work_description"]


def test_overtime_approval_expires_with_its_day(org, client_for):
    alice = client_for(org["alice"])
    yesterday = DAY - datetime.timedelta(days=1)
    office_check_in(alice, at(9, day=yesterday))
    post(alice, "/api/attendance/check-out/", at(9, 20, day=yesterday))
    rid = post(alice, "/api/attendance/overtime/request/", at(9, 25, day=yesterday), {**DECLARE,
               "use_other_reason": True, "other_reason": "Quarter-end report for finance"}
               ).data["state"]["open_overtime_request"]["id"]
    post(client_for(org["hr"]), f"/api/attendance/overtime/{rid}/approve/", at(9, 26, day=yesterday))
    after_checkout(alice)
    assert post(alice, "/api/attendance/overtime/start/", at(9, 30)).status_code == 409
    res = post(alice, "/api/attendance/overtime/request/", at(9, 31), {**DECLARE, "use_other_reason": True,
               "other_reason": "Quarter-end report for finance"})
    assert res.status_code == 201
    old = OvertimeSession.objects.get(pk=rid)
    assert old.status == "CANCELLED" and old.end_reason == "EXPIRED"


def test_offline_overtime_start_needs_an_approval(org, client_for):
    alice = client_for(org["alice"])
    after_checkout(alice)
    with freeze(at(10)):
        res = alice.post(
            "/api/attendance/sync/",
            {"events": [{"id": str(uuid.uuid4()), "type": "OVERTIME_START", "occurred_at": at(9, 40).isoformat()}]},
            format="json",
        )
    assert res.data["results"][0]["status"] == "CONFLICT"
    assert not OvertimeSession.objects.filter(status="ACTIVE").exists()


# --- email delivery problems never break HR work -------------------------------------------


def test_smtp_failure_is_logged_without_secrets_and_the_action_succeeds(
    org, client_for, settings, caplog, django_capture_on_commit_callbacks
):
    settings.EMAIL_HOST_PASSWORD = "s3cret-smtp-pass"
    rid = wfh_request(client_for(org["alice"])).data["id"]
    boom = smtplib.SMTPAuthenticationError(535, b"Authentication failed")
    with mock.patch("apps.core.mail.send_mail", side_effect=boom), django_capture_on_commit_callbacks(execute=True):
        res = decide(org, rid)
    assert res.status_code == 200
    assert WorkFromHomeRequest.objects.get(pk=rid).status == "APPROVED"
    text = "\n".join(r.getMessage() for r in caplog.records if r.name == "nexvra.email")
    assert "SMTPAuthenticationError" in text and "Authentication failed" in text
    assert "s3cret-smtp-pass" not in text
