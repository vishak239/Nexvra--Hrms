import datetime
from decimal import Decimal
from unittest import mock

import pytest
from django.utils import timezone

from apps.attendance.models import AttendanceRecord
from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db

UTC = datetime.UTC


def at(hour, minute=0, day=datetime.date(2025, 3, 3)):  # Monday
    return datetime.datetime.combine(day, datetime.time(hour, minute), tzinfo=UTC)


def freeze(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


@pytest.fixture(autouse=True)
def _inactivity_rule_off(configure):
    """These scenarios check in and out hours apart without activity reports; the inactivity
    rule itself is tested in test_attendance_rules.py."""
    configure(inactivity_timeout_minutes=None)


def test_check_in_and_out(org, client_for):
    client = client_for(org["alice"])
    with freeze(at(9)):
        res = client.post("/api/attendance/check-in/")
    assert res.status_code == 201
    assert res.data["status"] == "PRESENT"
    assert res.data["is_late"] is False  # no work start time configured
    with freeze(at(17, 30)):
        res = client.post("/api/attendance/check-out/")
    assert res.status_code == 200
    assert res.data["worked_minutes"] == 510
    assert AuditLog.objects.filter(action="ATTENDANCE_CHECK_OUT").exists()


def test_double_check_in_and_invalid_check_out_conflict(org, client_for):
    client = client_for(org["alice"])
    with freeze(at(9)):
        assert client.post("/api/attendance/check-out/").status_code == 409
        assert client.post("/api/attendance/check-in/").status_code == 201
        res = client.post("/api/attendance/check-in/")
        assert res.status_code == 409
        assert res.data["error"]["code"] == "conflict"
        assert client.post("/api/attendance/check-out/").status_code == 200
        assert client.post("/api/attendance/check-out/").status_code == 409


def test_late_only_when_configured(org, client_for, configure):
    client = client_for(org["alice"])
    with freeze(at(10)):
        assert client.post("/api/attendance/check-in/").data["is_late"] is False

    configure(work_start_time=datetime.time(9, 0), late_grace_minutes=15)
    bob = client_for(org["bob"])
    with freeze(at(9, 10)):
        assert bob.post("/api/attendance/check-in/").data["is_late"] is False
    carol = client_for(org["carol"])
    with freeze(at(9, 16)):
        assert carol.post("/api/attendance/check-in/").data["is_late"] is True


def test_late_uses_company_timezone(org, client_for, configure):
    configure(timezone="Asia/Kolkata", work_start_time=datetime.time(9, 0), late_grace_minutes=0)
    client = client_for(org["alice"])
    # 03:00 UTC == 08:30 IST -> on time
    with freeze(at(3, 0)):
        res = client.post("/api/attendance/check-in/")
    assert res.data["is_late"] is False
    assert res.data["date"] == "2025-03-03"


def test_half_day_thresholds_only_when_configured(org, client_for, configure):
    configure(half_day_min_hours=Decimal("4"), full_day_min_hours=Decimal("8"))
    cases = [("alice", 9, 18, "PRESENT"), ("bob", 9, 14, "HALF_DAY"), ("carol", 9, 11, "ABSENT")]
    for who, start, end, expected in cases:
        client = client_for(org[who])
        with freeze(at(start)):
            client.post("/api/attendance/check-in/")
        with freeze(at(end)):
            assert client.post("/api/attendance/check-out/").data["status"] == expected, who


def test_self_attendance_can_be_disabled(org, client_for, configure):
    configure(self_attendance_enabled=False)
    assert client_for(org["alice"]).post("/api/attendance/check-in/").status_code == 403


def test_exited_employee_cannot_check_in(org, client_for):
    org["alice"].employment_status = "EXITED"
    org["alice"].exit_date = datetime.date(2025, 1, 31)
    org["alice"].save()
    assert client_for(org["alice"]).post("/api/attendance/check-in/").status_code == 403


def make_record(employee, day=datetime.date(2025, 3, 3)):
    return AttendanceRecord.objects.create(employee=employee, date=day, check_in=at(9, day=day))


def test_attendance_visibility_is_scoped(org, client_for):
    for who in ("alice", "bob", "carol", "manager", "hr"):
        make_record(org[who])

    def employees_seen(who):
        res = client_for(org[who]).get("/api/attendance/")
        return {r["employee"]["id"] for r in res.data["results"]}

    assert employees_seen("alice") == {org["alice"].id}
    assert employees_seen("manager") == {org["manager"].id, org["alice"].id, org["bob"].id}
    assert len(employees_seen("hr")) == 5

    carol_record = AttendanceRecord.objects.get(employee=org["carol"])
    assert client_for(org["alice"]).get(f"/api/attendance/{carol_record.id}/").status_code == 404
    assert client_for(org["manager"]).get(f"/api/attendance/{carol_record.id}/").status_code == 404


def test_hr_corrects_attendance_and_it_is_audited(org, client_for, configure):
    configure(half_day_min_hours=Decimal("4"), full_day_min_hours=Decimal("8"))
    client = client_for(org["hr"])
    res = client.post(
        "/api/attendance/",
        {
            "employee": org["alice"].id,
            "date": "2025-03-04",
            "check_in": "2025-03-04T09:00:00Z",
            "check_out": "2025-03-04T13:00:00Z",
            "remarks": "Forgot to check in",
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["status"] == "HALF_DAY"
    assert res.data["source"] == "ADMIN"
    record_id = res.data["id"]
    res = client.patch(f"/api/attendance/{record_id}/", {"status": "PRESENT"}, format="json")
    assert res.data["status"] == "PRESENT"
    assert AuditLog.objects.filter(action="ATTENDANCE_CORRECTED", entity_id=str(record_id)).exists()

    dup = client.post("/api/attendance/", {"employee": org["alice"].id, "date": "2025-03-04"}, format="json")
    assert dup.status_code == 400


def test_hr_cannot_correct_own_attendance(org, client_for):
    res = client_for(org["hr"]).post(
        "/api/attendance/", {"employee": org["hr"].id, "date": "2025-03-04"}, format="json"
    )
    assert res.status_code == 403


def test_checkout_before_checkin_rejected(org, client_for):
    res = client_for(org["hr"]).post(
        "/api/attendance/",
        {"employee": org["alice"].id, "date": "2025-03-04", "check_in": "2025-03-04T10:00:00Z",
         "check_out": "2025-03-04T09:00:00Z"},
        format="json",
    )
    assert res.status_code == 400


def test_manager_and_employee_cannot_write_records(org, client_for):
    for who in ("manager", "alice"):
        res = client_for(org[who]).post(
            "/api/attendance/", {"employee": org["alice"].id, "date": "2025-03-04"}, format="json"
        )
        assert res.status_code == 403


def test_daily_status_for_manager(org, client_for, configure):
    configure(working_days=[0, 1, 2, 3, 4])
    monday = datetime.date(2025, 3, 3)
    make_record(org["alice"], monday)
    res = client_for(org["manager"]).get("/api/attendance/daily/", {"date": "2025-03-03"})
    statuses = {r["employee"]["id"]: r["status"] for r in res.data["results"]}
    assert statuses[org["alice"].id] == "PRESENT"
    assert statuses[org["bob"].id] == "ABSENT"  # past working day without record
    assert org["carol"].id not in statuses

    res = client_for(org["manager"]).get("/api/attendance/daily/", {"date": "2025-03-08"})  # Saturday
    assert {r["status"] for r in res.data["results"]} == {"WEEKLY_OFF"}


def test_daily_status_requires_team_or_all_scope(org, client_for):
    assert client_for(org["alice"]).get("/api/attendance/daily/").status_code == 403


def test_today_endpoint(org, client_for):
    client = client_for(org["alice"])
    res = client.get("/api/attendance/today/")
    assert res.status_code == 200
    assert res.data["record"] is None
    assert res.data["date"] == timezone.localdate()
