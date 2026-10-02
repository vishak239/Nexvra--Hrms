import re

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from conftest import PASSWORD

pytestmark = pytest.mark.django_db


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login/", {"email": email, "password": password}, format="json")


def test_login_success_returns_profile_and_permissions(anon, org):
    alice = org["alice"].user
    res = login(anon, alice.email)
    assert res.status_code == 200
    assert res.data["email"] == alice.email
    assert res.data["role"]["code"] == "EMPLOYEE"
    assert set(res.data["permissions"]) == {"attendance.self", "leave.apply", "payroll.view_own", "documents.view_own"}
    assert res.data["employee"]["employee_code"] == org["alice"].employee_code
    assert "nexvra_session" in res.cookies
    assert res.cookies["nexvra_session"]["httponly"]
    assert anon.get("/api/auth/me/").status_code == 200
    assert AuditLog.objects.filter(action="LOGIN", actor=alice).exists()


def test_login_email_is_case_insensitive(anon, org):
    assert login(anon, org["alice"].user.email.upper()).status_code == 200


def test_login_wrong_password_is_generic_and_audited(anon, org):
    res = login(anon, org["alice"].user.email, "wrong-password")
    assert res.status_code == 400
    assert res.data["error"]["message"] == "Invalid email or password."
    assert AuditLog.objects.filter(action="LOGIN_FAILED", metadata__email=org["alice"].user.email).exists()


def test_login_unknown_email_gives_same_error(anon, db):
    res = login(anon, "nobody@example.test")
    assert res.status_code == 400
    assert res.data["error"]["message"] == "Invalid email or password."


def test_inactive_user_cannot_login(anon, org):
    user = org["alice"].user
    user.is_active = False
    user.save()
    assert login(anon, user.email).status_code == 400


def test_deactivated_user_session_stops_working(org, client_for):
    client = client_for(org["alice"])
    assert client.get("/api/auth/me/").status_code == 200
    user = org["alice"].user
    user.is_active = False
    user.save()
    assert client.get("/api/auth/me/").status_code == 401


def test_password_is_hashed(org):
    user = org["alice"].user
    assert user.password != PASSWORD
    assert user.check_password(PASSWORD)


def test_unauthenticated_requests_get_401(anon, db):
    for url in ["/api/auth/me/", "/api/employees/", "/api/attendance/", "/api/dashboard/", "/api/settings/"]:
        res = anon.get(url)
        assert res.status_code == 401, url
        assert res.data["error"]["code"] == "not_authenticated"


def test_logout_ends_session(anon, org):
    login(anon, org["alice"].user.email)
    assert anon.post("/api/auth/logout/").status_code == 204
    assert anon.get("/api/auth/me/").status_code == 401


def test_login_enforces_csrf(org):
    client = APIClient(enforce_csrf_checks=True)
    assert login(client, org["alice"].user.email).status_code == 403
    client.get("/api/auth/csrf/")
    token = client.cookies["csrftoken"].value
    res = client.post(
        "/api/auth/login/",
        {"email": org["alice"].user.email, "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert res.status_code == 200


def test_authenticated_unsafe_requests_require_csrf(org):
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/auth/csrf/")
    token = client.cookies["csrftoken"].value
    login_res = client.post(
        "/api/auth/login/",
        {"email": org["alice"].user.email, "password": PASSWORD},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert login_res.status_code == 200
    # csrf token rotates on login
    assert client.post("/api/attendance/check-in/").status_code == 403
    token = client.cookies["csrftoken"].value
    assert client.post("/api/attendance/check-in/", HTTP_X_CSRFTOKEN=token).status_code == 201


def test_login_is_throttled(anon, org, settings):
    for _ in range(10):
        login(anon, org["alice"].user.email, "bad")
    assert login(anon, org["alice"].user.email).status_code == 429


def test_change_password(org, client_for):
    client = client_for(org["alice"])
    bad = client.post("/api/auth/change-password/", {"current_password": "nope", "new_password": "An0ther-pass!"})
    assert bad.status_code == 400
    weak = client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": "123"})
    assert weak.status_code == 400
    ok = client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": "An0ther-pass!"})
    assert ok.status_code == 200
    assert client.get("/api/auth/me/").status_code == 200  # session kept
    org["alice"].user.refresh_from_db()
    assert org["alice"].user.check_password("An0ther-pass!")


def test_password_reset_does_not_enumerate(anon, org):
    a = anon.post("/api/auth/password-reset/", {"email": "nobody@example.test"})
    b = anon.post("/api/auth/password-reset/", {"email": org["alice"].user.email})
    assert a.status_code == b.status_code == 200
    assert a.data == b.data
    assert len(mail.outbox) == 1


def test_password_reset_confirm_flow(anon, org):
    anon.post("/api/auth/password-reset/", {"email": org["alice"].user.email})
    body = mail.outbox[0].body
    uid = re.search(r"uid=([^&\s]+)", body).group(1)
    token = re.search(r"token=([^&\s]+)", body).group(1)
    bad = anon.post("/api/auth/password-reset/confirm/", {"uid": uid, "token": "x-y", "new_password": "N3w-pass-word!"})
    assert bad.status_code == 400
    ok = anon.post("/api/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "N3w-pass-word!"})
    assert ok.status_code == 200
    # single use
    again = anon.post("/api/auth/password-reset/confirm/", {"uid": uid, "token": token, "new_password": "N3w-pass-2!"})
    assert again.status_code == 400
    assert login(anon, org["alice"].user.email, "N3w-pass-word!").status_code == 200


def test_error_envelope_shape(anon, db):
    res = anon.post("/api/auth/login/", {"email": "not-an-email"}, format="json")
    assert res.status_code == 400
    assert set(res.data["error"]) == {"code", "message", "fields"}
    assert "email" in res.data["error"]["fields"]
    assert "password" in res.data["error"]["fields"]


def test_session_endpoint_never_errors(anon, org, client_for):
    res = anon.get("/api/auth/session/")
    assert res.status_code == 200
    assert res.data == {"authenticated": False, "user": None}
    res = client_for(org["alice"]).get("/api/auth/session/")
    assert res.data["authenticated"] is True
    assert res.data["user"]["email"] == org["alice"].user.email
