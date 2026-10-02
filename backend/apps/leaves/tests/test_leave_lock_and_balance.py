"""Approval lock and exactly-once balance deduction."""

import threading
from decimal import Decimal

import pytest
from django.db import connection
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.leaves.models import LeaveBalance, LeaveBalanceTransaction, LeaveRequest, LeaveType

pytestmark = pytest.mark.django_db


@pytest.fixture
def annual(db):
    return LeaveType.objects.create(name="Lock Annual", code="LA", annual_allocation=Decimal("12"))


@pytest.fixture
def balance(org, annual):
    return LeaveBalance.objects.create(employee=org["alice"], leave_type=annual, year=2030, allocated=Decimal("12"))


def apply(client, leave_type, start="2030-02-04", end="2030-02-06"):
    res = client.post(
        "/api/leaves/requests/", {"leave_type": leave_type.id, "start_date": start, "end_date": end}, format="json"
    )
    assert res.status_code == 201, res.data
    return res.data["id"]


def mine(client):
    return client.get("/api/leaves/balances/mine/", {"year": 2030}).data["results"][0]


def test_pending_request_does_not_reduce_balance(org, client_for, annual, balance):
    alice = client_for(org["alice"])
    apply(alice, annual)  # 3 days
    summary = mine(alice)
    assert Decimal(summary["available"]) == 12
    assert Decimal(summary["used"]) == 0
    assert Decimal(summary["pending"]) == 3
    assert Decimal(summary["requestable"]) == 9


def test_rejected_and_cancelled_requests_do_not_reduce_balance(org, client_for, annual, balance):
    alice = client_for(org["alice"])
    rejected = apply(alice, annual)
    client_for(org["manager"]).post(f"/api/leaves/requests/{rejected}/reject/")
    cancelled = apply(alice, annual, "2030-03-04", "2030-03-06")
    assert alice.post(f"/api/leaves/requests/{cancelled}/cancel/").data["status"] == "CANCELLED"
    summary = mine(alice)
    assert Decimal(summary["available"]) == 12 and Decimal(summary["pending"]) == 0
    assert not LeaveBalanceTransaction.objects.exists()


def test_approval_deducts_exactly_once_with_audit(org, client_for, annual, balance):
    alice = client_for(org["alice"])
    leave_id = apply(alice, annual)
    manager = client_for(org["manager"])
    res = manager.post(f"/api/leaves/requests/{leave_id}/approve/")
    assert res.status_code == 200
    assert res.data["is_locked"] is True and res.data["can_cancel"] is False
    assert Decimal(res.data["balance_deducted"]) == 3
    assert Decimal(mine(alice)["available"]) == 9

    # approving again (double click, refresh, network retry) never deducts twice
    assert manager.post(f"/api/leaves/requests/{leave_id}/approve/").status_code == 409
    assert client_for(org["hr"]).post(f"/api/leaves/requests/{leave_id}/approve/").status_code == 409
    assert Decimal(mine(alice)["available"]) == 9
    txn = LeaveBalanceTransaction.objects.get()
    assert (txn.days, txn.balance_before, txn.balance_after) == (Decimal("3"), Decimal("12"), Decimal("9"))
    assert txn.created_by_id == org["manager"].user_id
    assert AuditLog.objects.filter(action="LEAVE_BALANCE_DEDUCTED", entity_id=str(leave_id)).count() == 1


def test_approved_leave_cannot_be_cancelled_by_applicant(org, client_for, annual, balance):
    alice = client_for(org["alice"])
    leave_id = apply(alice, annual)
    client_for(org["manager"]).post(f"/api/leaves/requests/{leave_id}/approve/")
    res = alice.post(f"/api/leaves/requests/{leave_id}/cancel/")  # direct API call, future-dated leave
    assert res.status_code == 409
    assert res.data["error"]["message"] == "This leave has already been approved and cannot be cancelled."
    assert LeaveRequest.objects.get(pk=leave_id).status == "APPROVED"
    assert Decimal(mine(alice)["available"]) == 9


def test_pending_can_be_cancelled_and_flags(org, client_for, annual, balance):
    alice = client_for(org["alice"])
    leave_id = apply(alice, annual)
    detail = alice.get(f"/api/leaves/requests/{leave_id}/").data
    assert detail["can_cancel"] is True and detail["is_locked"] is False and detail["balance_deducted"] is None
    assert client_for(org["manager"]).get(f"/api/leaves/requests/{leave_id}/").data["can_cancel"] is False


def test_balance_never_goes_negative_on_approval(org, client_for, annual, balance):
    alice = client_for(org["alice"])
    first = apply(alice, annual, "2030-02-04", "2030-02-11")  # 8 days
    second = apply(alice, annual, "2030-03-04", "2030-03-07")  # 4 days (8 + 4 = 12 requestable)
    balance.allocated = Decimal("10")  # HR lowers the allocation meanwhile
    balance.save()
    manager = client_for(org["manager"])
    assert manager.post(f"/api/leaves/requests/{first}/approve/").status_code == 200
    res = manager.post(f"/api/leaves/requests/{second}/approve/")
    assert res.status_code == 400
    assert "Insufficient balance to approve" in res.data["error"]["message"]
    assert LeaveRequest.objects.get(pk=second).status == "PENDING"
    assert Decimal(mine(alice)["available"]) == 2


def test_allocation_cannot_drop_below_used(org, client_for, annual, balance):
    leave_id = apply(client_for(org["alice"]), annual)
    client_for(org["manager"]).post(f"/api/leaves/requests/{leave_id}/approve/")
    res = client_for(org["hr"]).patch(f"/api/leaves/balances/{balance.id}/", {"allocated": "2"}, format="json")
    assert res.status_code == 400
    assert client_for(org["hr"]).delete(f"/api/leaves/balances/{balance.id}/").status_code == 409


def test_balance_transactions_visibility(org, client_for, annual, balance):
    LeaveBalance.objects.create(employee=org["carol"], leave_type=annual, year=2030, allocated=Decimal("12"))
    for who, approver in (("alice", "manager"), ("carol", "other_manager")):
        leave_id = apply(client_for(org[who]), annual)
        client_for(org[approver]).post(f"/api/leaves/requests/{leave_id}/approve/")

    def employees(who):
        rows = client_for(org[who]).get("/api/leaves/balance-transactions/").data["results"]
        return {r["employee"]["id"] for r in rows}

    assert employees("alice") == {org["alice"].id}
    assert employees("manager") == {org["alice"].id}
    assert employees("hr") == {org["alice"].id, org["carol"].id}


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_concurrent_approvals_deduct_once(org, annual):
    balance = LeaveBalance.objects.create(employee=org["alice"], leave_type=annual, year=2030, allocated=Decimal("12"))
    leave = LeaveRequest.objects.create(
        employee=org["alice"], leave_type=annual, start_date="2030-02-04", end_date="2030-02-06",
        days=Decimal("3"), leave_year=2030,
    )
    approvers = [org["manager"].user, org["hr"].user, org["super_admin"].user]
    barrier = threading.Barrier(len(approvers))
    statuses = []

    def approve(user):
        try:
            client = APIClient()
            client.force_login(user)
            barrier.wait()
            statuses.append(client.post(f"/api/leaves/requests/{leave.id}/approve/").status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=approve, args=(u,)) for u in approvers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(statuses) == [200, 409, 409]
    assert LeaveBalanceTransaction.objects.filter(balance=balance).count() == 1
    leave.refresh_from_db()
    assert leave.status == "APPROVED"
