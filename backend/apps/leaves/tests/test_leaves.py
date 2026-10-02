import datetime
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.leaves.models import LeaveBalance, LeaveRequest, LeaveType
from apps.notifications.models import Notification
from apps.organization.models import Holiday

pytestmark = pytest.mark.django_db


@pytest.fixture
def annual(db):
    return LeaveType.objects.create(name="Test Annual", code="TA", annual_allocation=Decimal("10"), allow_half_day=True)


@pytest.fixture
def untracked(db):
    return LeaveType.objects.create(name="Test Untracked", code="TU", annual_allocation=None)


@pytest.fixture
def balances(org, annual):
    for who in ("alice", "bob", "carol", "manager", "hr"):
        LeaveBalance.objects.create(employee=org[who], leave_type=annual, year=2030, allocated=Decimal("10"))


def apply(client, leave_type, start, end, **extra):
    return client.post(
        "/api/leaves/requests/",
        {"leave_type": leave_type.id, "start_date": start, "end_date": end, **extra},
        format="json",
    )


# --- day counting ------------------------------------------------------------------


def test_days_are_calendar_days_when_working_days_not_configured(org, client_for, annual, balances):
    res = apply(client_for(org["alice"]), annual, "2030-01-04", "2030-01-07")  # Fri..Mon
    assert res.status_code == 201, res.data
    assert Decimal(res.data["days"]) == 4


def test_days_exclude_weekly_off_and_holidays_when_configured(org, client_for, annual, balances, configure):
    configure(working_days=[0, 1, 2, 3, 4])
    Holiday.objects.create(date=datetime.date(2030, 1, 7), name="Test holiday")
    Holiday.objects.create(date=datetime.date(2030, 1, 8), name="Optional", is_optional=True)
    res = apply(client_for(org["alice"]), annual, "2030-01-04", "2030-01-08")  # Fri..Tue
    assert Decimal(res.data["days"]) == 2  # Fri + Tue (optional holiday counts)


def test_range_with_no_working_days_rejected(org, client_for, annual, balances, configure):
    configure(working_days=[0, 1, 2, 3, 4])
    res = apply(client_for(org["alice"]), annual, "2030-01-05", "2030-01-06")  # weekend
    assert res.status_code == 400


def test_half_day(org, client_for, annual, balances, untracked):
    client = client_for(org["alice"])
    res = apply(client, annual, "2030-01-07", "2030-01-07", is_half_day=True, half_day_period="FIRST")
    assert Decimal(res.data["days"]) == Decimal("0.5")
    res = apply(client, untracked, "2030-01-09", "2030-01-09", is_half_day=True, half_day_period="FIRST")
    assert res.status_code == 400  # type does not allow half days
    res = apply(client, annual, "2030-01-09", "2030-01-10", is_half_day=True, half_day_period="FIRST")
    assert res.status_code == 400  # half day must be single date


# --- validation --------------------------------------------------------------------


def test_balance_enforced(org, client_for, annual, balances):
    client = client_for(org["alice"])
    assert apply(client, annual, "2030-02-01", "2030-02-08").status_code == 201  # 8 days
    res = apply(client, annual, "2030-03-01", "2030-03-03")  # 3 more > 2 available
    assert res.status_code == 400
    assert "Insufficient balance" in res.data["error"]["message"]


def test_no_allocation_means_no_tracked_leave(org, client_for, annual):
    res = apply(client_for(org["alice"]), annual, "2030-02-01", "2030-02-01")
    assert res.status_code == 400
    assert "leave_type" in res.data["error"]["fields"]


def test_untracked_type_needs_no_balance(org, client_for, untracked):
    assert apply(client_for(org["alice"]), untracked, "2030-02-01", "2030-02-03").status_code == 201


def test_overlapping_requests_rejected(org, client_for, annual, balances):
    client = client_for(org["alice"])
    apply(client, annual, "2030-02-01", "2030-02-03")
    assert apply(client, annual, "2030-02-03", "2030-02-04").status_code == 400


def test_end_before_start_rejected(org, client_for, annual, balances):
    assert apply(client_for(org["alice"]), annual, "2030-02-05", "2030-02-01").status_code == 400


def test_cannot_span_leave_years(org, client_for, annual, balances):
    assert apply(client_for(org["alice"]), annual, "2030-12-30", "2031-01-02").status_code == 400


def test_inactive_type_rejected(org, client_for, annual, balances):
    annual.is_active = False
    annual.save()
    assert apply(client_for(org["alice"]), annual, "2030-02-01", "2030-02-01").status_code == 400


def test_cannot_apply_for_someone_else(org, client_for, annual, balances):
    res = client_for(org["alice"]).post(
        "/api/leaves/requests/",
        {"leave_type": annual.id, "start_date": "2030-02-01", "end_date": "2030-02-01", "employee": org["bob"].id},
        format="json",
    )
    assert res.status_code == 201
    assert LeaveRequest.objects.get(pk=res.data["id"]).employee == org["alice"]


# --- approvals ---------------------------------------------------------------------


def test_manager_approves_direct_report_and_employee_is_notified(org, client_for, annual, balances):
    leave_id = apply(client_for(org["alice"]), annual, "2030-02-01", "2030-02-02").data["id"]
    assert Notification.objects.filter(recipient=org["manager"].user, type="LEAVE_SUBMITTED").exists()

    manager = client_for(org["manager"])
    pending = manager.get("/api/leaves/requests/pending-approvals/")
    assert [r["id"] for r in pending.data["results"]] == [leave_id]
    assert pending.data["results"][0]["can_decide"] is True

    res = manager.post(f"/api/leaves/requests/{leave_id}/approve/", {"note": "Enjoy"}, format="json")
    assert res.status_code == 200
    assert res.data["status"] == "APPROVED"
    assert Notification.objects.filter(recipient=org["alice"].user, type="LEAVE_APPROVED").exists()
    assert AuditLog.objects.filter(action="LEAVE_APPROVED", entity_id=str(leave_id)).exists()

    balance = client_for(org["alice"]).get("/api/leaves/balances/mine/", {"year": 2030}).data["results"][0]
    assert Decimal(balance["used"]) == 2
    assert Decimal(balance["available"]) == 8

    assert manager.post(f"/api/leaves/requests/{leave_id}/approve/").status_code == 409


def test_manager_cannot_approve_outside_team(org, client_for, annual, balances):
    leave_id = apply(client_for(org["carol"]), annual, "2030-02-01", "2030-02-01").data["id"]
    res = client_for(org["manager"]).post(f"/api/leaves/requests/{leave_id}/approve/")
    assert res.status_code == 404
    assert LeaveRequest.objects.get(pk=leave_id).status == "PENDING"


def test_employee_cannot_approve(org, client_for, annual, balances):
    leave_id = apply(client_for(org["alice"]), annual, "2030-02-01", "2030-02-01").data["id"]
    assert client_for(org["bob"]).post(f"/api/leaves/requests/{leave_id}/approve/").status_code == 403
    assert client_for(org["alice"]).post(f"/api/leaves/requests/{leave_id}/approve/").status_code == 403


def test_nobody_approves_own_leave(org, client_for, annual, balances):
    leave_id = apply(client_for(org["hr"]), annual, "2030-02-01", "2030-02-01").data["id"]
    res = client_for(org["hr"]).post(f"/api/leaves/requests/{leave_id}/approve/")
    assert res.status_code == 403
    # another approver with approve_all can
    assert client_for(org["super_admin"]).post(f"/api/leaves/requests/{leave_id}/approve/").status_code == 200


def test_hr_approves_anyone_and_rejects_with_note(org, client_for, annual, balances):
    leave_id = apply(client_for(org["carol"]), annual, "2030-02-01", "2030-02-01").data["id"]
    res = client_for(org["hr"]).post(f"/api/leaves/requests/{leave_id}/reject/", {"note": "Busy"}, format="json")
    assert res.data["status"] == "REJECTED"
    assert res.data["decision_note"] == "Busy"


def test_employee_sees_only_own_requests(org, client_for, annual, balances):
    apply(client_for(org["alice"]), annual, "2030-02-01", "2030-02-01")
    carol_id = apply(client_for(org["carol"]), annual, "2030-02-01", "2030-02-01").data["id"]
    res = client_for(org["alice"]).get("/api/leaves/requests/")
    assert {r["employee"]["id"] for r in res.data["results"]} == {org["alice"].id}
    assert client_for(org["alice"]).get(f"/api/leaves/requests/{carol_id}/").status_code == 404


def test_cancel_rules(org, client_for, annual, balances):
    alice = client_for(org["alice"])
    pending_id = apply(alice, annual, "2030-02-01", "2030-02-01").data["id"]
    assert client_for(org["bob"]).post(f"/api/leaves/requests/{pending_id}/cancel/").status_code == 404
    assert client_for(org["manager"]).post(f"/api/leaves/requests/{pending_id}/cancel/").status_code == 403
    assert alice.post(f"/api/leaves/requests/{pending_id}/cancel/").data["status"] == "CANCELLED"

    # approved leave in the past cannot be cancelled
    past = LeaveRequest.objects.create(
        employee=org["alice"], leave_type=annual, start_date=datetime.date(2024, 5, 1),
        end_date=datetime.date(2024, 5, 1), days=1, leave_year=2024, status="APPROVED",
    )
    assert alice.post(f"/api/leaves/requests/{past.id}/cancel/").status_code == 409


# --- types & balances --------------------------------------------------------------


def test_only_hr_manages_types_and_balances(org, client_for, annual):
    for who in ("alice", "manager"):
        client = client_for(org[who])
        assert client.post("/api/leaves/types/", {"name": "X", "code": "X"}).status_code == 403
        assert client.post(
            "/api/leaves/balances/", {"employee": org["alice"].id, "leave_type": annual.id, "year": 2030,
                                      "allocated": "99"}
        ).status_code == 403
    assert client_for(org["alice"]).get("/api/leaves/types/").status_code == 200


def test_hr_bulk_allocates_but_not_to_self(org, client_for, annual):
    res = client_for(org["hr"]).post(
        "/api/leaves/balances/allocate/", {"leave_type": annual.id, "year": 2030}, format="json"
    )
    assert res.status_code == 200
    assert res.data["created"] == 6  # everyone except HR
    assert not LeaveBalance.objects.filter(employee=org["hr"]).exists()
    assert LeaveBalance.objects.get(employee=org["alice"], year=2030).allocated == Decimal("10")


def test_hr_cannot_edit_own_balance(org, client_for, annual, balances):
    own = LeaveBalance.objects.get(employee=org["hr"])
    assert client_for(org["hr"]).patch(f"/api/leaves/balances/{own.id}/", {"allocated": "50"}).status_code == 403


def test_leave_type_in_use_cannot_be_deleted(org, client_for, annual, balances):
    assert client_for(org["hr"]).delete(f"/api/leaves/types/{annual.id}/").status_code == 409
