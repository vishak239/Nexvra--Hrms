import datetime
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.payroll.models import PayComponent, Payslip, SalaryStructure, SalaryStructureItem

pytestmark = pytest.mark.django_db


@pytest.fixture
def components(db):
    return {
        "base": PayComponent.objects.create(name="Test Base", code="TBASE", kind="EARNING"),
        "allowance": PayComponent.objects.create(name="Test Allowance", code="TALW", kind="EARNING"),
        "deduction": PayComponent.objects.create(name="Test Deduction", code="TDED", kind="DEDUCTION"),
    }


def give_salary(employee, components, base="1000.00", allowance="200.00", deduction="50.00",
                effective=datetime.date(2025, 1, 1)):
    structure = SalaryStructure.objects.create(employee=employee, effective_from=effective)
    for key, amount in (("base", base), ("allowance", allowance), ("deduction", deduction)):
        SalaryStructureItem.objects.create(structure=structure, component=components[key], amount=Decimal(amount))
    return structure


@pytest.fixture
def run(org, client_for, components):
    for who in ("alice", "bob", "carol"):
        give_salary(org[who], components)
    client = client_for(org["hr"])
    run_id = client.post("/api/payroll/runs/", {"year": 2025, "month": 3}, format="json").data["id"]
    return run_id


def test_hr_creates_structure_via_api(org, client_for, components):
    res = client_for(org["hr"]).post(
        "/api/payroll/salary-structures/",
        {
            "employee": org["alice"].id,
            "effective_from": "2025-01-01",
            "items": [
                {"component": components["base"].id, "amount": "3000.00"},
                {"component": components["deduction"].id, "amount": "100.00"},
            ],
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["gross_earnings"] == "3000.00"
    assert res.data["net_pay"] == "2900.00"
    assert AuditLog.objects.filter(action="SALARY_STRUCTURE_CREATED").exists()


def test_duplicate_component_in_structure_rejected(org, client_for, components):
    res = client_for(org["hr"]).post(
        "/api/payroll/salary-structures/",
        {
            "employee": org["alice"].id,
            "effective_from": "2025-01-01",
            "items": [
                {"component": components["base"].id, "amount": "1"},
                {"component": components["base"].id, "amount": "2"},
            ],
        },
        format="json",
    )
    assert res.status_code == 400


def test_hr_cannot_set_own_salary(org, client_for, components):
    res = client_for(org["hr"]).post(
        "/api/payroll/salary-structures/",
        {"employee": org["hr"].id, "effective_from": "2025-01-01", "items": []},
        format="json",
    )
    assert res.status_code == 403


def test_generate_computes_totals_without_statutory_deductions(org, client_for, run):
    client = client_for(org["hr"])
    res = client.post(f"/api/payroll/runs/{run}/generate/")
    assert res.status_code == 200
    assert res.data["created"] == 3
    # people without a structure are reported, not silently paid
    assert set(res.data["missing_structure"]) >= {org["hr"].employee_code, org["manager"].employee_code}
    payslip = Payslip.objects.get(run_id=run, employee=org["alice"])
    assert payslip.gross_earnings == Decimal("1200.00")
    assert payslip.total_deductions == Decimal("50.00")
    assert payslip.net_pay == Decimal("1150.00")
    assert payslip.items.count() == 3
    # running again does not duplicate
    assert client.post(f"/api/payroll/runs/{run}/generate/").data["created"] == 0


def test_latest_effective_structure_is_used(org, client_for, components):
    give_salary(org["alice"], components, base="1000.00", effective=datetime.date(2025, 1, 1))
    give_salary(org["alice"], components, base="2000.00", effective=datetime.date(2025, 3, 15))
    give_salary(org["alice"], components, base="9999.00", effective=datetime.date(2025, 4, 1))
    client = client_for(org["hr"])
    run_id = client.post("/api/payroll/runs/", {"year": 2025, "month": 3}, format="json").data["id"]
    client.post(f"/api/payroll/runs/{run_id}/generate/")
    assert Payslip.objects.get(run_id=run_id, employee=org["alice"]).gross_earnings == Decimal("2200.00")


def test_duplicate_run_period_conflicts(org, client_for, run):
    res = client_for(org["hr"]).post("/api/payroll/runs/", {"year": 2025, "month": 3}, format="json")
    assert res.status_code in (400, 409)


def test_adjustments_and_finalize_lock(org, client_for, run):
    client = client_for(org["hr"])
    client.post(f"/api/payroll/runs/{run}/generate/")
    payslip = Payslip.objects.get(run_id=run, employee=org["alice"])
    res = client.post(
        f"/api/payroll/payslips/{payslip.id}/adjustments/",
        {"name": "Test bonus", "kind": "EARNING", "amount": "100.00"},
        format="json",
    )
    assert res.status_code == 201
    assert res.data["net_pay"] == "1250.00"
    adj_id = next(i["id"] for i in res.data["items"] if i["source"] == "ADJUSTMENT")

    res = client.post(f"/api/payroll/runs/{run}/finalize/")
    assert res.status_code == 200
    assert res.data["status"] == "FINALIZED"
    assert Notification.objects.filter(recipient=org["alice"].user, type="PAYSLIP_PUBLISHED").exists()

    # locked
    assert client.post(f"/api/payroll/runs/{run}/generate/").status_code == 409
    assert client.post(
        f"/api/payroll/payslips/{payslip.id}/adjustments/", {"name": "x", "kind": "EARNING", "amount": "1"},
        format="json",
    ).status_code == 409
    assert client.delete(f"/api/payroll/payslips/{payslip.id}/adjustments/{adj_id}/").status_code == 409
    assert client.delete(f"/api/payroll/payslips/{payslip.id}/").status_code == 409
    assert client.delete(f"/api/payroll/runs/{run}/").status_code == 409
    assert client.post(f"/api/payroll/runs/{run}/finalize/").status_code == 409


def test_cannot_finalize_empty_run(org, client_for):
    client = client_for(org["hr"])
    run_id = client.post("/api/payroll/runs/", {"year": 2025, "month": 5}, format="json").data["id"]
    assert client.post(f"/api/payroll/runs/{run_id}/finalize/").status_code == 400


def test_employee_sees_only_own_finalized_payslips(org, client_for, run):
    hr = client_for(org["hr"])
    hr.post(f"/api/payroll/runs/{run}/generate/")
    alice = client_for(org["alice"])
    assert alice.get("/api/payroll/payslips/").data["count"] == 0  # draft not visible

    hr.post(f"/api/payroll/runs/{run}/finalize/")
    res = alice.get("/api/payroll/payslips/")
    assert res.data["count"] == 1
    assert res.data["results"][0]["employee"]["id"] == org["alice"].id

    bob_slip = Payslip.objects.get(run_id=run, employee=org["bob"])
    assert alice.get(f"/api/payroll/payslips/{bob_slip.id}/").status_code == 404


def test_manager_has_no_access_to_team_payroll(org, client_for, run):
    hr = client_for(org["hr"])
    hr.post(f"/api/payroll/runs/{run}/generate/")
    hr.post(f"/api/payroll/runs/{run}/finalize/")
    manager = client_for(org["manager"])
    alice_slip = Payslip.objects.get(run_id=run, employee=org["alice"])
    assert manager.get(f"/api/payroll/payslips/{alice_slip.id}/").status_code == 404
    assert manager.get("/api/payroll/runs/").status_code == 403
    assert manager.get("/api/payroll/salary-structures/").status_code == 403


@pytest.mark.parametrize("who", ["alice", "manager"])
def test_non_hr_cannot_run_payroll(org, client_for, who):
    client = client_for(org[who])
    assert client.post("/api/payroll/runs/", {"year": 2025, "month": 6}, format="json").status_code == 403
    assert client.get("/api/payroll/components/").status_code == 403
