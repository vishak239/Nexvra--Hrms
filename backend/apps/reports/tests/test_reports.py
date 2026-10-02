import datetime

import pytest

from apps.attendance.models import AttendanceRecord
from apps.organization.models import Holiday

pytestmark = pytest.mark.django_db


def test_headcount_scoped_by_role(org, client_for):
    hr = client_for(org["hr"]).get("/api/reports/headcount/")
    assert hr.status_code == 200
    assert hr.data["total_current"] == 7
    manager = client_for(org["manager"]).get("/api/reports/headcount/")
    assert manager.data["total_current"] == 3  # self + 2 direct reports
    assert client_for(org["alice"]).get("/api/reports/headcount/").status_code == 403


def test_attendance_summary(org, client_for, configure):
    configure(working_days=[0, 1, 2, 3, 4])
    Holiday.objects.create(date=datetime.date(2025, 3, 5), name="Test holiday")
    AttendanceRecord.objects.create(
        employee=org["alice"], date=datetime.date(2025, 3, 3), is_late=True,
        check_in=datetime.datetime(2025, 3, 3, 9, tzinfo=datetime.UTC),
    )
    res = client_for(org["manager"]).get(
        "/api/reports/attendance-summary/", {"date_from": "2025-03-03", "date_to": "2025-03-09"}
    )
    assert res.status_code == 200
    alice = next(r for r in res.data["results"] if r["employee_id"] == org["alice"].id)
    assert alice["present"] == 1
    assert alice["late"] == 1
    assert alice["holiday"] == 1
    assert alice["weekly_off"] == 2
    assert alice["absent"] == 3
    assert {r["employee_id"] for r in res.data["results"]} == {org["manager"].id, org["alice"].id, org["bob"].id}


def test_attendance_summary_range_limits(org, client_for):
    client = client_for(org["hr"])
    assert client.get("/api/reports/attendance-summary/", {"date_from": "2025-03-10",
                                                           "date_to": "2025-03-01"}).status_code == 400
    assert client.get("/api/reports/attendance-summary/", {"date_from": "2025-01-01",
                                                           "date_to": "2025-12-31"}).status_code == 400


def test_csv_export_neutralises_formulas(org, client_for):
    org["alice"].user.first_name = "=HYPERLINK(evil)"
    org["alice"].user.save()
    res = client_for(org["hr"]).get(
        "/api/reports/attendance-summary/", {"date_from": "2025-03-03", "date_to": "2025-03-03", "export": "csv"}
    )
    assert res.status_code == 200
    assert res["Content-Type"] == "text/csv"
    body = res.content.decode()
    assert "'=HYPERLINK(evil)" in body


def test_payroll_summary_hr_only(org, client_for):
    assert client_for(org["manager"]).get("/api/reports/payroll-summary/").status_code == 403
    assert client_for(org["hr"]).get("/api/reports/payroll-summary/").data == {"run": None}


def test_leave_summary(org, client_for):
    assert client_for(org["hr"]).get("/api/reports/leave-summary/", {"year": 2030}).status_code == 200


def test_dashboard_is_role_aware(org, client_for):
    emp = client_for(org["alice"]).get("/api/dashboard/").data
    assert "me" in emp
    assert "headcount" not in emp and "pending_approvals" not in emp and "latest_payroll_run" not in emp

    mgr = client_for(org["manager"]).get("/api/dashboard/").data
    assert mgr["team_size"] == 2
    assert mgr["pending_approvals"] == 0
    assert mgr["attendance_today"]["total"] == 2
    assert "headcount" not in mgr

    hr = client_for(org["hr"]).get("/api/dashboard/").data
    assert hr["headcount"] == 7
    assert "latest_payroll_run" in hr
