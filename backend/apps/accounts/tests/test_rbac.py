"""Role matrix, administrative endpoints and privilege-escalation guards."""

import pytest

from apps.accounts.models import Permission, Role, User
from apps.accounts.rbac import ROLES

pytestmark = pytest.mark.django_db

ADMIN_ONLY_GET = ["/api/users/", "/api/audit-logs/", "/api/permissions/"]


def test_default_role_matrix_matches_catalogue(db):
    for code, (_, level, perms) in ROLES.items():
        role = Role.objects.get(code=code)
        assert role.level == level
        assert set(role.permissions.values_list("codename", flat=True)) == perms


def test_super_admin_implicitly_holds_new_permissions(org):
    Permission.objects.create(codename="future.feature")
    user = User.objects.get(pk=org["super_admin"].user.pk)
    assert user.has_permission("future.feature")


@pytest.mark.parametrize("who", ["alice", "manager", "hr"])
def test_non_super_admins_cannot_reach_system_admin_endpoints(org, client_for, who):
    client = client_for(org[who])
    for url in ADMIN_ONLY_GET:
        assert client.get(url).status_code == 403, (who, url)
    payload = {"email": "x@example.test", "first_name": "X", "role": "EMPLOYEE"}
    assert client.post("/api/users/", payload).status_code == 403
    assert client.patch("/api/company/", {"name": "Hacked"}).status_code == 403


def test_super_admin_reaches_admin_endpoints(org, client_for):
    client = client_for(org["super_admin"])
    for url in ADMIN_ONLY_GET:
        assert client.get(url).status_code == 200, url
    assert client.patch("/api/company/", {"legal_name": "Nexvra Solutions Pvt"}).status_code == 200


def test_hr_cannot_edit_role_permissions(org, client_for):
    hr_role = Role.objects.get(code="HR_ADMIN")
    res = client_for(org["hr"]).patch(f"/api/roles/{hr_role.id}/", {"permissions": ["audit.view"]}, format="json")
    assert res.status_code == 403
    assert not hr_role.permissions.filter(codename="audit.view").exists()


def test_super_admin_can_edit_role_permissions_and_it_is_audited(org, client_for):
    role = Role.objects.get(code="MANAGER")
    perms = sorted(set(role.permissions.values_list("codename", flat=True)) | {"reports.view_all"})
    res = client_for(org["super_admin"]).patch(f"/api/roles/{role.id}/", {"permissions": perms}, format="json")
    assert res.status_code == 200
    assert role.permissions.filter(codename="reports.view_all").exists()
    from apps.audit.models import AuditLog

    log = AuditLog.objects.get(action="ROLE_PERMISSIONS_CHANGED")
    assert log.changes["added"] == ["reports.view_all"]


def test_super_admin_role_permissions_are_immutable(org, client_for):
    role = Role.objects.get(code="SUPER_ADMIN")
    res = client_for(org["super_admin"]).patch(f"/api/roles/{role.id}/", {"permissions": []}, format="json")
    assert res.status_code == 400


def test_system_roles_cannot_be_deleted(org, client_for):
    role = Role.objects.get(code="EMPLOYEE")
    assert client_for(org["super_admin"]).delete(f"/api/roles/{role.id}/").status_code == 403


def test_permission_revocation_takes_effect(org, client_for):
    role = Role.objects.get(code="EMPLOYEE")
    role.permissions.remove(Permission.objects.get(codename="attendance.self"))
    assert client_for(org["alice"]).post("/api/attendance/check-in/").status_code == 403


# --- escalation ------------------------------------------------------------------


@pytest.mark.parametrize("role", ["HR_ADMIN", "SUPER_ADMIN"])
def test_hr_cannot_create_employee_with_equal_or_higher_role(org, client_for, role):
    res = client_for(org["hr"]).post(
        "/api/employees/",
        {
            "email": "escalate@example.test",
            "first_name": "Esc",
            "role": role,
            "employee_code": "ESC1",
            "joining_date": "2025-01-01",
            "employment_type": "FULL_TIME",
        },
        format="json",
    )
    assert res.status_code == 403
    assert not User.objects.filter(email="escalate@example.test").exists()


def test_hr_cannot_promote_employee_to_hr(org, client_for):
    res = client_for(org["hr"]).patch(f"/api/employees/{org['alice'].id}/", {"role": "HR_ADMIN"}, format="json")
    assert res.status_code == 403
    org["alice"].user.refresh_from_db()
    assert org["alice"].user.role.code == "EMPLOYEE"


def test_hr_can_promote_employee_to_manager(org, client_for):
    res = client_for(org["hr"]).patch(f"/api/employees/{org['alice'].id}/", {"role": "MANAGER"}, format="json")
    assert res.status_code == 200
    assert res.data["role"] == "MANAGER"


def test_hr_cannot_edit_or_deactivate_super_admin(org, client_for):
    client = client_for(org["hr"])
    sa = org["super_admin"]
    assert client.patch(f"/api/employees/{sa.id}/", {"is_active": False}, format="json").status_code == 403
    assert client.patch(f"/api/employees/{sa.id}/", {"phone": "123"}, format="json").status_code == 403
    sa.user.refresh_from_db()
    assert sa.user.is_active


def test_hr_cannot_change_own_role(org, client_for):
    hr = org["hr"]
    res = client_for(hr).patch(f"/api/employees/{hr.id}/", {"role": "SUPER_ADMIN"}, format="json")
    assert res.status_code == 403


def test_super_admin_cannot_demote_or_deactivate_self(org, client_for):
    sa = org["super_admin"].user
    client = client_for(sa)
    assert client.patch(f"/api/users/{sa.id}/", {"role": "EMPLOYEE"}, format="json").status_code == 403
    assert client.patch(f"/api/users/{sa.id}/", {"is_active": False}, format="json").status_code == 403


def test_super_admin_can_create_hr_user(org, client_for):
    res = client_for(org["super_admin"]).post(
        "/api/users/",
        {"email": "New.HR@Example.test", "first_name": "New", "role": "HR_ADMIN", "password": "S3cure-pass-word"},
        format="json",
    )
    assert res.status_code == 201, res.data
    user = User.objects.get(email="new.hr@example.test")
    assert user.role.code == "HR_ADMIN"
    assert user.check_password("S3cure-pass-word")
    assert "must_change_password" not in res.data


def test_super_admin_password_reset_lets_user_log_in_directly(org, client_for, anon):
    alice = org["alice"].user
    res = client_for(org["super_admin"]).patch(
        f"/api/users/{alice.id}/", {"password": "Res3t-by-admin!"}, format="json"
    )
    assert res.status_code == 200, res.data
    login = anon.post("/api/auth/login/", {"email": alice.email, "password": "Res3t-by-admin!"}, format="json")
    assert login.status_code == 200
    assert anon.get("/api/auth/me/").status_code == 200


def test_duplicate_email_rejected_case_insensitively(org, client_for):
    res = client_for(org["super_admin"]).post(
        "/api/users/",
        {"email": org["alice"].user.email.upper(), "first_name": "Dup", "role": "EMPLOYEE"},
        format="json",
    )
    assert res.status_code == 400
    assert "email" in res.data["error"]["fields"]


def test_employee_cannot_change_own_role_via_self_service(org, client_for):
    client = client_for(org["alice"])
    res = client.patch("/api/employees/me/", {"role": "SUPER_ADMIN", "phone": "+1999"}, format="json")
    assert res.status_code == 200
    org["alice"].user.refresh_from_db()
    assert org["alice"].user.role.code == "EMPLOYEE"
    assert res.data["phone"] == "+1999"
