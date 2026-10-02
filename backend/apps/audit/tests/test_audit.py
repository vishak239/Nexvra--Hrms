import pytest

from apps.audit.models import AuditLog
from conftest import PASSWORD

pytestmark = pytest.mark.django_db


def test_audit_log_is_super_admin_only(org, client_for):
    for who in ("alice", "manager", "hr"):
        assert client_for(org[who]).get("/api/audit-logs/").status_code == 403
    assert client_for(org["super_admin"]).get("/api/audit-logs/").status_code == 200


def test_audit_log_is_read_only(org, client_for):
    log = AuditLog.objects.create(action="TEST")
    client = client_for(org["super_admin"])
    assert client.post("/api/audit-logs/", {"action": "FORGED"}).status_code == 405
    assert client.patch(f"/api/audit-logs/{log.id}/", {"action": "X"}).status_code == 405
    assert client.delete(f"/api/audit-logs/{log.id}/").status_code == 405
    assert AuditLog.objects.filter(pk=log.id, action="TEST").exists()


def test_audit_records_actor_ip_and_redacts_passwords(org, anon, client_for):
    anon.post("/api/auth/login/", {"email": org["alice"].user.email, "password": PASSWORD}, format="json",
              REMOTE_ADDR="10.1.2.3", HTTP_USER_AGENT="pytest-agent")
    log = AuditLog.objects.get(action="LOGIN")
    assert log.actor == org["alice"].user
    assert log.actor_email == org["alice"].user.email
    assert log.ip_address == "10.1.2.3"
    assert log.user_agent == "pytest-agent"

    client_for(org["hr"]).post(
        "/api/employees/",
        {"email": "pw@example.test", "first_name": "P", "employee_code": "PW1", "joining_date": "2025-01-01",
         "employment_type": "FULL_TIME", "initial_password": "S3cret-initial!"},
        format="json",
    )
    for entry in AuditLog.objects.all():
        assert "S3cret-initial!" not in str(entry.changes) + str(entry.metadata)


def test_audit_log_filters(org, client_for):
    AuditLog.objects.create(action="LEAVE_APPROVED", entity_type="leaves.LeaveRequest", entity_id="5")
    AuditLog.objects.create(action="LOGIN")
    res = client_for(org["super_admin"]).get("/api/audit-logs/", {"action": "leave_approved"})
    assert [r["entity_id"] for r in res.data["results"]] == ["5"]
