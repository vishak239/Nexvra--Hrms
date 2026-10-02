import pytest

from apps.audit.models import AuditLog
from apps.organization.models import CompanySettings, Department

pytestmark = pytest.mark.django_db


def test_settings_start_unconfigured(db):
    cs = CompanySettings.get_solo()
    for field in ("working_days", "work_start_time", "late_grace_minutes", "half_day_min_hours",
                  "full_day_min_hours", "leave_year_start_month", "currency"):
        assert getattr(cs, field) in (None, ""), field
    assert cs.employee_document_upload_enabled is False


def test_everyone_can_read_settings_and_company(org, client_for):
    client = client_for(org["alice"])
    assert client.get("/api/settings/").status_code == 200
    assert client.get("/api/company/").data["name"] == "Nexvra Solutions"


def test_hr_updates_settings_and_it_is_audited(org, client_for):
    res = client_for(org["hr"]).patch(
        "/api/settings/",
        {"working_days": [4, 0, 1, 2, 3], "work_start_time": "09:30", "currency": "inr", "timezone": "Asia/Kolkata"},
        format="json",
    )
    assert res.status_code == 200, res.data
    assert res.data["working_days"] == [0, 1, 2, 3, 4]
    assert res.data["currency"] == "INR"
    log = AuditLog.objects.get(action="SETTINGS_UPDATED")
    assert log.changes["work_start_time"] == [None, "09:30:00"]


@pytest.mark.parametrize(
    "payload",
    [
        {"working_days": [0, 7]},
        {"working_days": [1, 1]},
        {"timezone": "Mars/Base"},
        {"half_day_min_hours": "4"},
        {"half_day_min_hours": "8", "full_day_min_hours": "4"},
        {"work_start_time": "18:00", "work_end_time": "09:00"},
        {"currency": "RUPEES"},
        {"leave_year_start_month": 13},
    ],
)
def test_settings_validation(org, client_for, payload):
    assert client_for(org["hr"]).patch("/api/settings/", payload, format="json").status_code == 400


def test_non_hr_cannot_change_settings(org, client_for):
    for who in ("alice", "manager"):
        assert client_for(org[who]).patch("/api/settings/", {"currency": "USD"}, format="json").status_code == 403


def test_hr_cannot_change_company_profile(org, client_for):
    assert client_for(org["hr"]).patch("/api/company/", {"name": "X"}, format="json").status_code == 403


def test_departments_crud_and_protection(org, client_for):
    hr = client_for(org["hr"])
    res = hr.post("/api/departments/", {"name": "Finance", "code": "fin"}, format="json")
    assert res.status_code == 201
    assert res.data["code"] == "FIN"
    assert hr.post("/api/departments/", {"name": "Finance", "code": "FIN2"}, format="json").status_code == 400
    in_use = org["department"]
    assert hr.delete(f"/api/departments/{in_use.id}/").status_code == 409
    assert Department.objects.filter(pk=in_use.id).exists()
    assert hr.delete(f"/api/departments/{res.data['id']}/").status_code == 204


def test_employee_can_list_but_not_edit_org_data(org, client_for):
    client = client_for(org["alice"])
    assert client.get("/api/departments/").status_code == 200
    assert client.get("/api/designations/").status_code == 200
    assert client.get("/api/holidays/").status_code == 200
    assert client.post("/api/departments/", {"name": "X", "code": "X"}).status_code == 403
    assert client.post("/api/holidays/", {"name": "X", "date": "2030-01-01"}).status_code == 403


def test_holidays_unique_and_filter_by_year(org, client_for):
    hr = client_for(org["hr"])
    assert hr.post("/api/holidays/", {"name": "Test Day", "date": "2030-01-01"}).status_code == 201
    assert hr.post("/api/holidays/", {"name": "Test Day", "date": "2030-01-01"}).status_code == 400
    hr.post("/api/holidays/", {"name": "Other", "date": "2031-01-01"})
    assert [h["date"] for h in hr.get("/api/holidays/", {"year": 2030}).data] == ["2030-01-01"]
