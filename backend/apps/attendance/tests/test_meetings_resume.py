"""Meetings (working time paused), Resume Work after an inactivity check-out, non-working time,
and the evidence rules of the inactivity check (offline activity, silent browsers)."""

import datetime
import math
from unittest import mock

import pytest
from django.core.management import call_command

from apps.attendance import geo
from apps.attendance.models import (
    AttendanceRecord,
    BreakSession,
    Meeting,
    MeetingPause,
    NonWorkingPeriod,
    ResumeWorkRequest,
    WorkFromHomeRequest,
)
from apps.audit.models import AuditLog
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db

UTC = datetime.UTC
DAY = datetime.date(2025, 3, 3)
WORK = (12.9716, 77.5946)


def at(hour, minute=0, second=0, day=DAY):
    return datetime.datetime.combine(day, datetime.time(hour, minute, second), tzinfo=UTC)


def freeze(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


def post(client, path, moment, data=None):
    with freeze(moment):
        return client.post(path, data or {}, format="json")


def patch(client, path, moment, data):
    with freeze(moment):
        return client.patch(path, data, format="json")


def get(client, path, moment):
    with freeze(moment):
        return client.get(path)


def check_in(client, moment, **data):
    res = post(client, "/api/attendance/check-in/", moment, data)
    assert res.status_code == 201, res.data
    return res


def beat(client, moment, activity=(), observed=None, idle=None):
    """A current-browser heartbeat: offsets (seconds ago) of real interactions."""
    activity = list(activity)
    data = {"idle_seconds": idle if idle is not None else (min(activity) if activity else 0), "activity": activity}
    if observed is not None:
        data["observed_seconds"] = observed
    return post(client, "/api/attendance/heartbeat/", moment, data)


def work(client, start, end, every=20):
    """Real activity every minute from `start` to `end`, reported every `every` minutes."""
    t = start
    while t < end:
        nxt = min(t + datetime.timedelta(minutes=every), end)
        span = int((nxt - t).total_seconds())
        beat(client, nxt, activity=list(range(0, span, 60)), observed=span + 1)
        t = nxt


def record(org, who="alice"):
    return AttendanceRecord.objects.get(employee=org[who])


def reconcile(moment):
    with freeze(moment):
        call_command("reconcile_attendance", stdout=mock.Mock())


@pytest.fixture
def hr(org, client_for):
    return client_for(org["hr"])


def new_meeting(client, moment, kind="OVERALL", participants=(), **extra):
    res = post(client, "/api/attendance/meetings/", moment,
               {"title": "All hands", "kind": kind, "participant_ids": list(participants), **extra})
    assert res.status_code == 201, res.data
    return res.data["id"]


def start(client, meeting_id, moment):
    return post(client, f"/api/attendance/meetings/{meeting_id}/start/", moment)


def end(client, meeting_id, moment):
    return post(client, f"/api/attendance/meetings/{meeting_id}/end/", moment)


# --- overall meetings ------------------------------------------------------------------


def test_overall_meeting_pauses_working_time_and_resumes_automatically(org, client_for, hr):
    """9:00 check-in, work until 11:00, meeting 11:00-12:00, work until 13:00."""
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    work(alice, at(9), at(11))
    meeting = new_meeting(hr, at(10))
    assert start(hr, meeting, at(11)).status_code == 200
    state = get(alice, "/api/attendance/today/", at(11, 30)).data
    assert state["active_pause"]["meeting"] == meeting and state["active_meeting"]["status"] == "ACTIVE"
    assert Notification.objects.filter(recipient=org["alice"].user, type="MEETING_STARTED").exists()

    # No activity for 55 minutes during the meeting: no inactivity check-out (heartbeats keep coming).
    beat(alice, at(11, 50), activity=[])
    reconcile(at(11, 55))
    assert record(org).check_out is None

    assert end(hr, meeting, at(12)).status_code == 200
    rec = record(org)
    assert rec.check_out is None  # the session stayed open: no new check-in needed
    assert rec.total_meeting_seconds == 3600
    assert MeetingPause.objects.get(employee=org["alice"]).end_reason == "MEETING_ENDED"
    assert Notification.objects.filter(recipient=org["alice"].user, type="MEETING_ENDED").exists()

    # The inactivity clock restarts at the meeting end, not at the last activity (11:00).
    beat(alice, at(12, 20), activity=[])
    assert record(org).check_out is None
    work(alice, at(12, 20), at(13))
    assert post(alice, "/api/attendance/check-out/", at(13)).status_code == 200
    rec = record(org)
    assert rec.total_break_seconds == 0  # the meeting never used the break allowance
    assert rec.total_non_working_seconds == 0
    assert rec.worked_minutes == 3 * 60  # 9-11 and 12-13; the meeting hour is not work
    assert rec.meeting_minutes == 60


def test_meeting_ends_after_long_inactivity_and_detection_resumes(org, client_for, hr):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    meeting = new_meeting(hr, at(9, 5))
    start(hr, meeting, at(9, 10))
    end(hr, meeting, at(11))  # alice had no activity since 9:00
    assert record(org).check_out is None
    beat(alice, at(11, 29), activity=[])
    assert record(org).check_out is None
    beat(alice, at(11, 31), activity=[])  # 30 minutes without activity after the meeting
    rec = record(org)
    assert rec.check_out == at(11, 30) and rec.checkout_reason == "INACTIVITY_TIMEOUT"
    assert rec.total_meeting_seconds == 110 * 60


def test_meeting_closes_a_running_break_and_blocks_new_breaks(org, client_for, hr):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    work(alice, at(9), at(10, 50))
    post(alice, "/api/attendance/breaks/start/", at(10, 50))
    meeting = new_meeting(hr, at(10))
    start(hr, meeting, at(11))
    session = BreakSession.objects.get(employee=org["alice"])
    assert session.end_reason == "MEETING" and session.duration_seconds == 600
    blocked = post(alice, "/api/attendance/breaks/start/", at(11, 10))
    assert blocked.status_code == 409 and blocked.data["error"]["code"] == "in_meeting"
    end(hr, meeting, at(11, 30))
    state = get(alice, "/api/attendance/today/", at(11, 31)).data
    assert state["break_used_seconds"] == 600  # only the real break counts toward the allowance
    assert state["record"]["total_meeting_seconds"] == 1800


def test_check_in_during_a_meeting_is_paused_from_check_in(org, client_for, hr):
    meeting = new_meeting(hr, at(8))
    start(hr, meeting, at(8, 30))
    bob = client_for(org["bob"])
    check_in(bob, at(9))
    pause = MeetingPause.objects.get(employee=org["bob"])
    assert pause.started_at == at(9) and pause.status == "ACTIVE"
    end(hr, meeting, at(9, 30))
    assert record(org, "bob").total_meeting_seconds == 1800


def test_check_out_during_a_meeting_closes_the_pause(org, client_for, hr):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    work(alice, at(9), at(10))
    meeting = new_meeting(hr, at(9))
    start(hr, meeting, at(10))
    assert post(alice, "/api/attendance/check-out/", at(10, 20)).status_code == 200
    pause = MeetingPause.objects.get(employee=org["alice"])
    assert pause.end_reason == "CHECKOUT" and pause.duration_seconds == 1200
    rec = record(org)
    assert rec.worked_minutes == 60 and rec.meeting_minutes == 20


def test_no_geofence_exit_during_a_meeting(org, client_for, hr, configure):
    configure(workplace_latitude=WORK[0], workplace_longitude=WORK[1], geofence_radius_m=20,
              geofence_max_accuracy_m=100)
    alice = client_for(org["alice"])
    check_in(alice, at(9), latitude=WORK[0], longitude=WORK[1], accuracy=10)
    meeting = new_meeting(hr, at(9))
    start(hr, meeting, at(9, 10))
    far = WORK[0] + math.degrees(800 / geo.EARTH_RADIUS_M)
    post(alice, "/api/attendance/heartbeat/", at(9, 15),
         {"idle_seconds": 0, "activity": [], "location_status": "ok", "latitude": far, "longitude": WORK[1],
          "accuracy": 10})
    assert record(org).check_out is None


# --- selected meetings -------------------------------------------------------------------


def test_selected_meeting_pauses_only_participants(org, client_for, hr):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    check_in(alice, at(9))
    check_in(bob, at(9))
    work(alice, at(9), at(10))
    work(bob, at(9), at(10))
    meeting = new_meeting(hr, at(9), kind="SELECTED", participants=[org["alice"].id], title="1:1 with HR")
    assert start(hr, meeting, at(10)).status_code == 200
    assert MeetingPause.objects.filter(employee=org["alice"], status="ACTIVE").exists()
    assert not MeetingPause.objects.filter(employee=org["bob"]).exists()
    assert get(bob, "/api/attendance/today/", at(10, 1)).data["active_meeting"] is None
    assert Notification.objects.filter(recipient=org["alice"].user, type="MEETING_STARTED").exists()
    assert not Notification.objects.filter(recipient=org["bob"].user, type="MEETING_STARTED").exists()

    # Neither is active; only the non-participant is checked out for inactivity.
    beat(alice, at(10, 45), activity=[])
    beat(bob, at(10, 45), activity=[])
    assert record(org, "alice").check_out is None
    bob_rec = record(org, "bob")
    assert bob_rec.check_out == at(10, 30) and bob_rec.checkout_reason == "INACTIVITY_TIMEOUT"
    # Non-participants can still take breaks etc. Participants resume when it ends.
    end(hr, meeting, at(11))
    assert record(org, "alice").total_meeting_seconds == 3600
    assert record(org, "bob").total_meeting_seconds == 0


def test_participants_can_change_while_a_meeting_runs(org, client_for, hr):
    alice, bob = client_for(org["alice"]), client_for(org["bob"])
    check_in(alice, at(9, 50))
    check_in(bob, at(9, 50))
    meeting = new_meeting(hr, at(9), kind="SELECTED", participants=[org["alice"].id])
    start(hr, meeting, at(10))
    work(bob, at(9, 50), at(10, 15))
    res = patch(hr, f"/api/attendance/meetings/{meeting}/", at(10, 15), {"participant_ids": [org["bob"].id]})
    assert res.status_code == 200, res.data
    assert MeetingPause.objects.get(employee=org["alice"]).end_reason == "REMOVED"
    assert MeetingPause.objects.get(employee=org["bob"]).status == "ACTIVE"
    end(hr, meeting, at(10, 45))
    assert record(org, "alice").total_meeting_seconds == 900
    assert record(org, "bob").total_meeting_seconds == 1800


def test_meetings_cannot_overlap_invalidly(org, client_for, hr):
    alice = client_for(org["alice"])
    check_in(alice, at(9, 55))
    one = new_meeting(hr, at(9), kind="SELECTED", participants=[org["alice"].id])
    two = new_meeting(hr, at(9), kind="SELECTED", participants=[org["alice"].id, org["bob"].id])
    overall = new_meeting(hr, at(9))
    assert start(hr, one, at(10)).status_code == 200
    assert start(hr, two, at(10, 5)).status_code == 409  # alice is already in a running meeting
    assert start(hr, overall, at(10, 5)).status_code == 409  # another meeting runs
    assert start(hr, one, at(10, 6)).status_code == 409  # already running
    end(hr, one, at(10, 30))
    assert end(hr, one, at(10, 31)).status_code == 409
    assert start(hr, overall, at(11)).status_code == 200
    assert start(hr, two, at(11, 1)).status_code == 409  # everyone is already paused
    second_overall = new_meeting(hr, at(11))
    assert start(hr, second_overall, at(11, 2)).status_code == 409


def test_meeting_validation_and_cancel(org, client_for, hr):
    res = post(hr, "/api/attendance/meetings/", at(9), {"title": "Sync", "kind": "SELECTED", "participant_ids": []})
    assert res.status_code == 400
    res = post(hr, "/api/attendance/meetings/", at(9),
               {"title": "Sync", "kind": "OVERALL", "scheduled_start": at(11).isoformat(),
                "scheduled_end": at(10).isoformat()})
    assert res.status_code == 400
    meeting = new_meeting(hr, at(9))
    assert post(hr, f"/api/attendance/meetings/{meeting}/cancel/", at(9, 5)).status_code == 200
    assert start(hr, meeting, at(9, 10)).status_code == 409
    assert Meeting.objects.get(pk=meeting).status == "CANCELLED"


def test_planned_end_time_ends_the_meeting(org, client_for, hr):
    alice = client_for(org["alice"])
    check_in(alice, at(9, 50))
    meeting = new_meeting(hr, at(9), scheduled_end=at(10, 30).isoformat())
    start(hr, meeting, at(10))
    reconcile(at(10, 40))
    m = Meeting.objects.get(pk=meeting)
    assert m.status == "COMPLETED" and m.ended_at == at(10, 30) and m.end_reason == "SCHEDULED_END"
    assert record(org).total_meeting_seconds == 1800


def test_meeting_permissions_and_visibility(org, client_for, hr):
    for who in ("alice", "manager"):
        client = client_for(org[who])
        res = post(client, "/api/attendance/meetings/", at(9), {"title": "Mine", "kind": "OVERALL"})
        assert res.status_code == 403
    overall = new_meeting(hr, at(9))
    private = new_meeting(hr, at(9), kind="SELECTED", participants=[org["bob"].id])
    assert post(client_for(org["alice"]), f"/api/attendance/meetings/{overall}/start/", at(9)).status_code == 403

    def visible(who):
        return {m["id"] for m in client_for(org[who]).get("/api/attendance/meetings/").data["results"]}

    assert visible("alice") == {overall}
    assert visible("bob") == {overall, private}
    assert visible("hr") == {overall, private}
    assert visible("super_admin") == {overall, private}
    assert AuditLog.objects.filter(action="MEETING_CREATED").count() == 2


# --- resume work ----------------------------------------------------------------------------


def go_idle(org, client_for, who="alice"):
    """Check in at 9:00, work until 11:00, then nothing: checked out at 11:30 for inactivity."""
    client = client_for(org[who])
    check_in(client, at(9))
    work(client, at(9), at(11))
    beat(client, at(11, 31), activity=[])
    rec = record(org, who)
    assert rec.check_out == at(11, 30) and rec.checkout_reason == "INACTIVITY_TIMEOUT"
    return client


def ask(client, moment, reason="I was in an offline discussion with the client."):
    return post(client, "/api/attendance/resume-requests/", moment, {"reason": reason})


def decide(client, request_id, moment, approve=True):
    return post(client, f"/api/attendance/resume-requests/{request_id}/{'approve' if approve else 'reject'}/",
                moment, {"note": "OK"})


def test_full_resume_flow_records_non_working_time(org, client_for, hr):
    alice = go_idle(org, client_for)
    period = NonWorkingPeriod.objects.get(employee=org["alice"])
    assert period.started_at == at(11, 30) and period.ended_at is None
    note = Notification.objects.get(recipient=org["alice"].user, type="ATTENDANCE_AUTO_CHECKOUT")
    assert "Resume Work" in note.message

    # A normal check-in cannot bypass the approval.
    blocked = post(alice, "/api/attendance/check-in/", at(11, 40))
    assert blocked.status_code == 409 and blocked.data["error"]["code"] == "resume_required"

    res = ask(alice, at(11, 45))
    assert res.status_code == 201, res.data
    request_id = res.data["state"]["resume_request"]["id"]
    assert res.data["state"]["resume_request"]["status"] == "PENDING"
    assert Notification.objects.filter(recipient=org["hr"].user, type="RESUME_REQUESTED").exists()
    assert ask(alice, at(11, 46)).status_code == 409  # one open request
    pending = post(alice, "/api/attendance/check-in/", at(11, 50))
    assert pending.status_code == 409 and pending.data["error"]["code"] == "resume_pending"

    assert decide(hr, request_id, at(12, 50)).status_code == 200
    assert Notification.objects.filter(recipient=org["alice"].user, type="RESUME_APPROVED").exists()
    rec = record(org)
    assert rec.check_out == at(11, 30)  # approval alone does not check anyone in

    check_in(alice, at(13))
    rec = record(org)
    assert rec.check_out is None and rec.check_in == at(9)
    assert rec.total_non_working_seconds == 90 * 60  # 11:30-13:00
    assert ResumeWorkRequest.objects.get(pk=request_id).status == "USED"
    assert AuditLog.objects.filter(action="ATTENDANCE_RESUMED").exists()
    assert post(alice, "/api/attendance/check-in/", at(13, 1)).status_code == 409  # duplicate check-in

    work(alice, at(13), at(16))
    post(alice, "/api/attendance/breaks/start/", at(16))
    state = post(alice, "/api/attendance/breaks/end/", at(16, 20)).data["state"]
    assert state["break_used_seconds"] == 1200  # non-working time never used the break allowance
    work(alice, at(16, 20), at(17))
    assert post(alice, "/api/attendance/check-out/", at(17)).status_code == 200
    rec = record(org)
    # 9:00-17:00 = 480 min - 90 non-working - 20 break = 370 min of working time
    assert rec.worked_minutes == 370
    assert rec.non_working_minutes == 90 and rec.break_minutes == 20 and rec.meeting_minutes == 0
    period.refresh_from_db()
    assert period.ended_at == at(13) and period.resume_request_id == request_id


def test_rejected_resume_keeps_the_employee_checked_out(org, client_for, hr):
    alice = go_idle(org, client_for)
    request_id = ask(alice, at(11, 45)).data["state"]["resume_request"]["id"]
    assert decide(hr, request_id, at(12), approve=False).status_code == 200
    assert Notification.objects.filter(recipient=org["alice"].user, type="RESUME_REJECTED").exists()
    blocked = post(alice, "/api/attendance/check-in/", at(12, 5))
    assert blocked.status_code == 409 and blocked.data["error"]["code"] == "resume_required"
    assert record(org).check_out == at(11, 30)
    assert decide(hr, request_id, at(12, 6)).status_code == 409  # already decided
    assert ask(alice, at(12, 10)).status_code == 201  # a new request may be sent


def test_resumed_check_in_runs_the_geofence_again(org, client_for, hr, configure):
    configure(workplace_latitude=WORK[0], workplace_longitude=WORK[1], geofence_radius_m=20,
              geofence_max_accuracy_m=100)
    alice = client_for(org["alice"])
    check_in(alice, at(9), latitude=WORK[0], longitude=WORK[1], accuracy=10)
    beat(alice, at(9, 31), activity=[])
    assert record(org).checkout_reason == "INACTIVITY_TIMEOUT"
    request_id = ask(alice, at(9, 40)).data["state"]["resume_request"]["id"]
    decide(hr, request_id, at(9, 45))
    far = WORK[0] + math.degrees(500 / geo.EARTH_RADIUS_M)
    outside = post(alice, "/api/attendance/check-in/", at(9, 50), {"latitude": far, "longitude": WORK[1],
                                                                    "accuracy": 10})
    assert outside.status_code == 403 and outside.data["error"]["code"] == "outside_geofence"
    assert record(org).check_out == at(9, 30)
    assert ResumeWorkRequest.objects.get(pk=request_id).status == "APPROVED"  # still usable
    check_in(alice, at(9, 55), latitude=WORK[0], longitude=WORK[1], accuracy=10)
    assert record(org).check_out is None


def test_resumed_check_in_needs_wfh_approval_for_work_from_home(org, client_for, hr):
    alice = go_idle(org, client_for)
    request_id = ask(alice, at(11, 45)).data["state"]["resume_request"]["id"]
    decide(hr, request_id, at(11, 50))
    res = post(alice, "/api/attendance/check-in/", at(12), {"mode": "WORK_FROM_HOME"})
    assert res.status_code == 403 and res.data["error"]["code"] == "wfh_not_approved"
    WorkFromHomeRequest.objects.create(employee=org["alice"], date=DAY, reason="Approved earlier",
                                       status=WorkFromHomeRequest.Status.APPROVED)
    res = post(alice, "/api/attendance/check-in/", at(12, 5), {"mode": "WORK_FROM_HOME"})
    assert res.status_code == 201, res.data
    assert record(org).mode == "WORK_FROM_HOME"


def test_resume_rules_and_permissions(org, client_for, hr):
    bob = client_for(org["bob"])
    check_in(bob, at(9))
    assert ask(bob, at(9, 10)).status_code == 409  # still working
    work(bob, at(9, 10), at(10))
    assert post(bob, "/api/attendance/check-out/", at(10)).status_code == 200
    assert ask(bob, at(10, 5)).status_code == 409  # manual check-out: nothing to resume
    assert ask(bob, at(10, 6), reason="short").status_code == 400

    alice = go_idle(org, client_for)
    request_id = ask(alice, at(11, 45)).data["state"]["resume_request"]["id"]
    assert decide(client_for(org["manager"]), request_id, at(11, 50)).status_code == 403  # HR / SA only
    assert decide(alice, request_id, at(11, 50)).status_code == 403
    assert client_for(org["bob"]).get(f"/api/attendance/resume-requests/{request_id}/").status_code == 404
    assert client_for(org["manager"]).get(f"/api/attendance/resume-requests/{request_id}/").status_code == 200
    # Approved but unused on its day: expired the next day.
    decide(client_for(org["super_admin"]), request_id, at(11, 55))
    tomorrow = DAY + datetime.timedelta(days=1)
    res = post(alice, "/api/attendance/check-in/", at(9, day=tomorrow))
    assert res.status_code == 201  # a new day starts normally
    ask(alice, at(9, 1, day=tomorrow))
    assert ResumeWorkRequest.objects.get(pk=request_id).status == "EXPIRED"


def test_hr_cannot_decide_their_own_resume_request(org, client_for):
    hr_client = go_idle(org, client_for, who="hr")
    request_id = ask(hr_client, at(11, 45)).data["state"]["resume_request"]["id"]
    assert decide(hr_client, request_id, at(11, 50)).status_code == 403
    assert decide(client_for(org["super_admin"]), request_id, at(11, 50)).status_code == 200


def test_cancel_resume_request(org, client_for):
    alice = go_idle(org, client_for)
    request_id = ask(alice, at(11, 45)).data["state"]["resume_request"]["id"]
    res = post(alice, f"/api/attendance/resume-requests/{request_id}/cancel/", at(11, 50))
    assert res.status_code == 200
    assert res.data["state"]["resume_request"]["status"] == "CANCELLED"
    assert post(alice, "/api/attendance/check-in/", at(12)).data["error"]["code"] == "resume_required"


# --- activity evidence ------------------------------------------------------------------------


def test_continuous_activity_never_reaches_the_timeout(org, client_for):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    for minute in range(3, 61, 3):  # a heartbeat every 3 minutes, activity about once a minute
        moment = at(9, minute) if minute < 60 else at(10)
        beat(alice, moment, activity=[170, 120, 60, 3], observed=minute * 60)
    reconcile(at(10, 1))
    rec = record(org)
    assert rec.check_out is None
    assert rec.last_activity_at == at(9, 59, 57)


def test_activity_seen_while_offline_prevents_a_check_out(org, client_for):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    beat(alice, at(9, 10), activity=[5], observed=600)
    # Network down 9:10-9:55 while the employee keeps working; the scheduled job waits.
    reconcile(at(9, 45))
    assert record(org).check_out is None
    offline = [(55 - m) * 60 for m in range(11, 55, 2)]  # activity every two minutes, as seconds ago
    res = beat(alice, at(9, 55), activity=offline, observed=3300)
    assert res.data["changed"] is False
    assert record(org).check_out is None
    assert record(org).last_activity_at == at(9, 53)


def test_a_gap_of_the_full_timeout_inside_the_report_checks_out_at_its_start(org, client_for):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    beat(alice, at(9, 5), activity=[0], observed=300)
    # Activity at 9:05, then none until 9:50 (offline the whole time), then activity again.
    res = beat(alice, at(9, 55), activity=[300], observed=3300)
    assert res.data["changed"] is True
    rec = record(org)
    assert rec.check_out == at(9, 35) and rec.checkout_reason == "INACTIVITY_TIMEOUT"


def test_reopening_the_browser_cannot_backfill_a_closed_period(org, client_for):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    beat(alice, at(9, 10), activity=[0], observed=600)
    # Browser closed at 9:10, reopened at 10:30: the new page has only watched for 10 seconds
    # and claims activity long before it was opened.
    res = beat(alice, at(10, 30), activity=[3600, 5], observed=10)
    assert res.data["changed"] is True
    assert record(org).check_out == at(9, 40)


def test_an_inactivity_check_out_in_a_heartbeat_is_not_followed_by_a_second_one(org, client_for, configure):
    configure(workplace_latitude=WORK[0], workplace_longitude=WORK[1], geofence_radius_m=20,
              geofence_max_accuracy_m=100)
    alice = client_for(org["alice"])
    check_in(alice, at(9), latitude=WORK[0], longitude=WORK[1], accuracy=10)
    far = WORK[0] + math.degrees(800 / geo.EARTH_RADIUS_M)
    # 40 minutes unobserved, and the reading says "far away": one check-out, for inactivity.
    res = post(alice, "/api/attendance/heartbeat/", at(9, 40),
               {"idle_seconds": 5, "activity": [5], "observed_seconds": 10, "location_status": "ok",
                "latitude": far, "longitude": WORK[1], "accuracy": 10})
    assert res.status_code == 200 and res.data["changed"] is True
    rec = record(org)
    assert rec.check_out == at(9, 30) and rec.checkout_reason == "INACTIVITY_TIMEOUT"
    assert AuditLog.objects.filter(action="ATTENDANCE_AUTO_CHECKOUT").count() == 1
    assert NonWorkingPeriod.objects.filter(employee=org["alice"], ended_at__isnull=True).count() == 1


def test_silent_browser_is_settled_after_the_grace_at_the_deadline(org, client_for):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    beat(alice, at(9, 20), activity=[0], observed=1200)
    reconcile(at(9, 55))  # deadline 9:50, silent: wait for the browser
    assert record(org).check_out is None
    reconcile(at(10, 21))  # silent for the whole grace
    assert record(org).check_out == at(9, 50)


def test_heartbeat_payload_is_validated(org, client_for):
    alice = client_for(org["alice"])
    check_in(alice, at(9))
    assert post(alice, "/api/attendance/heartbeat/", at(9, 1), {"idle_seconds": 0, "activity": [-5]}).status_code == 400
    too_many = {"idle_seconds": 0, "activity": [1] * 3001}
    assert post(alice, "/api/attendance/heartbeat/", at(9, 1), too_many).status_code == 400
    # Offsets beyond the check-in are clamped away, never moving activity before check-in.
    beat(alice, at(9, 2), activity=[7200])
    assert record(org).last_activity_at == at(9)


def test_invalid_check_out_and_duplicate_check_in(org, client_for):
    alice = client_for(org["alice"])
    assert post(alice, "/api/attendance/check-out/", at(9)).status_code == 409
    check_in(alice, at(9))
    assert post(alice, "/api/attendance/check-in/", at(9, 1)).status_code == 409
    post(alice, "/api/attendance/check-out/", at(17))
    assert post(alice, "/api/attendance/check-out/", at(17, 1)).status_code == 409


def test_today_payload_reports_all_four_time_categories(org, client_for, hr, configure):
    configure(full_day_min_hours=8, half_day_min_hours=4)
    alice = go_idle(org, client_for)
    rid = ask(alice, at(11, 45)).data["state"]["resume_request"]["id"]
    decide(hr, rid, at(11, 50))
    check_in(alice, at(12))
    work(alice, at(12), at(13))
    meeting = new_meeting(hr, at(12))
    start(hr, meeting, at(13))
    state = get(alice, "/api/attendance/today/", at(13, 30)).data
    assert state["required_work_seconds"] == 8 * 3600
    assert state["record"]["total_non_working_seconds"] == 1800
    assert state["active_pause"]["started_at"].startswith("2025-03-03T13:00")
    assert len(state["non_working"]) == 1 and state["open_non_working"] is None
    assert state["resume_request"]["status"] == "USED"
