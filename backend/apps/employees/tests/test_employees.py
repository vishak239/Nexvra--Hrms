import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.audit.models import AuditLog
from apps.employees.models import Employee

pytestmark = pytest.mark.django_db

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def new_employee_payload(**overrides):
    data = {
        "email": "dana@example.test",
        "first_name": "Dana",
        "last_name": "Lee",
        "employee_code": "NX-100",
        "joining_date": "2025-02-01",
        "employment_type": "FULL_TIME",
    }
    data.update(overrides)
    return data


# --- HR CRUD -----------------------------------------------------------------------


def test_hr_creates_employee_with_login_account(org, client_for, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):  # the account email is sent after the commit
        res = client_for(org["hr"]).post(
            "/api/employees/",
            new_employee_payload(department=org["department"].id, manager=org["manager"].id),
            format="json",
        )
    assert res.status_code == 201, res.data
    emp = Employee.objects.get(employee_code="NX-100")
    assert emp.user.email == "dana@example.test"
    assert emp.user.role.code == "EMPLOYEE"
    assert not emp.user.has_usable_password()  # set-password email instead
    assert len(mail.outbox) == 1
    assert AuditLog.objects.filter(action="EMPLOYEE_CREATED", entity_id=str(emp.id)).exists()


def test_employee_logs_in_with_initial_password_without_forced_change(org, client_for, anon):
    res = client_for(org["hr"]).post(
        "/api/employees/", new_employee_payload(initial_password="Init1al-pass!"), format="json"
    )
    assert res.status_code == 201
    user = Employee.objects.get(employee_code="NX-100").user
    assert user.check_password("Init1al-pass!")
    assert "Init1al-pass!" not in user.password  # stored hashed, never in clear text

    login = anon.post("/api/auth/login/", {"email": "dana@example.test", "password": "Init1al-pass!"}, format="json")
    assert login.status_code == 200
    assert "must_change_password" not in login.data
    assert anon.get("/api/auth/me/").status_code == 200
    assert anon.get("/api/users/").status_code == 403  # role permissions are unchanged


def test_employee_code_and_email_are_unique(org, client_for):
    client = client_for(org["hr"])
    res = client.post("/api/employees/", new_employee_payload(employee_code=org["alice"].employee_code), format="json")
    assert res.status_code == 400 and "employee_code" in res.data["error"]["fields"]
    res = client.post("/api/employees/", new_employee_payload(email=org["alice"].user.email), format="json")
    assert res.status_code == 400 and "email" in res.data["error"]["fields"]


def test_reporting_cycle_is_rejected(org, client_for):
    res = client_for(org["hr"]).patch(
        f"/api/employees/{org['manager'].id}/", {"manager": org["alice"].id}, format="json"
    )
    assert res.status_code == 400
    assert "manager" in res.data["error"]["fields"]


def test_exit_requires_exit_date_and_is_audited(org, client_for):
    client = client_for(org["hr"])
    url = f"/api/employees/{org['bob'].id}/"
    assert client.patch(url, {"employment_status": "EXITED"}, format="json").status_code == 400
    res = client.patch(url, {"employment_status": "EXITED", "exit_date": "2025-06-30"}, format="json")
    assert res.status_code == 200
    log = AuditLog.objects.filter(action="EMPLOYEE_UPDATED", entity_id=str(org["bob"].id)).latest("id")
    assert log.changes["employment_status"] == ["ACTIVE", "EXITED"]


def test_exit_deactivates_login_only_when_configured(org, client_for, configure):
    client = client_for(org["hr"])
    client.patch(f"/api/employees/{org['bob'].id}/", {"employment_status": "EXITED", "exit_date": "2025-06-30"},
                 format="json")
    org["bob"].user.refresh_from_db()
    assert org["bob"].user.is_active
    configure(deactivate_user_on_exit=True)
    client.patch(f"/api/employees/{org['carol'].id}/", {"employment_status": "EXITED", "exit_date": "2025-06-30"},
                 format="json")
    org["carol"].user.refresh_from_db()
    assert not org["carol"].user.is_active


def test_employees_cannot_be_hard_deleted(org, client_for):
    assert client_for(org["hr"]).delete(f"/api/employees/{org['alice'].id}/").status_code == 405


def test_non_hr_cannot_create_or_update_employees(org, client_for):
    for who in ("alice", "manager"):
        client = client_for(org[who])
        assert client.post("/api/employees/", new_employee_payload(), format="json").status_code == 403
        assert client.patch(f"/api/employees/{org['bob'].id}/", {"phone": "1"}, format="json").status_code == 403


# --- isolation ---------------------------------------------------------------------


def test_employee_lists_only_themselves(org, client_for):
    res = client_for(org["alice"]).get("/api/employees/")
    assert res.status_code == 200
    assert [r["id"] for r in res.data["results"]] == [org["alice"].id]


def test_employee_cannot_view_another_employee(org, client_for):
    client = client_for(org["alice"])
    for other in ("bob", "carol", "manager", "hr"):
        res = client.get(f"/api/employees/{org[other].id}/")
        assert res.status_code == 404, other


def test_manager_sees_only_team_and_self(org, client_for):
    res = client_for(org["manager"]).get("/api/employees/")
    ids = {r["id"] for r in res.data["results"]}
    assert ids == {org["manager"].id, org["alice"].id, org["bob"].id}


def test_manager_cannot_view_employee_outside_team(org, client_for):
    client = client_for(org["manager"])
    assert client.get(f"/api/employees/{org['carol'].id}/").status_code == 404
    assert client.get(f"/api/employees/{org['hr'].id}/").status_code == 404


def test_manager_does_not_receive_confidential_fields(org, client_for):
    res = client_for(org["manager"]).get(f"/api/employees/{org['alice'].id}/")
    assert res.status_code == 200
    for field in ("phone", "address", "emergency_contact_name", "role", "is_active"):
        assert field not in res.data
    assert res.data["full_name"] == org["alice"].user.full_name


def test_employee_and_hr_receive_confidential_fields(org, client_for):
    own = client_for(org["alice"]).get("/api/employees/me/")
    assert own.data["address"] == "1 Private Road"
    hr = client_for(org["hr"]).get(f"/api/employees/{org['alice'].id}/")
    assert hr.data["phone"] == "+10000000001"


def test_self_service_only_changes_contact_fields(org, client_for):
    res = client_for(org["alice"]).patch(
        "/api/employees/me/",
        {"address": "New address", "employee_code": "HACK", "employment_status": "EXITED", "manager": None},
        format="json",
    )
    assert res.status_code == 200
    org["alice"].refresh_from_db()
    assert org["alice"].address == "New address"
    assert org["alice"].employee_code != "HACK"
    assert org["alice"].employment_status == "ACTIVE"
    assert org["alice"].manager_id == org["manager"].id


def test_search_and_filter(org, client_for):
    client = client_for(org["hr"])
    res = client.get("/api/employees/", {"department": org["department"].id})
    assert {r["id"] for r in res.data["results"]} == {org["manager"].id, org["alice"].id, org["bob"].id}
    res = client.get("/api/employees/", {"search": org["carol"].employee_code})
    assert [r["id"] for r in res.data["results"]] == [org["carol"].id]


# --- photo -------------------------------------------------------------------------


def test_photo_upload_validation_and_private_access(org, client_for):
    alice = client_for(org["alice"])
    url = f"/api/employees/{org['alice'].id}/photo/"
    fake = SimpleUploadedFile("me.png", b"not really a png", content_type="image/png")
    assert alice.post(url, {"photo": fake}, format="multipart").status_code == 400
    exe = SimpleUploadedFile("me.exe", b"MZ....", content_type="application/octet-stream")
    assert alice.post(url, {"photo": exe}, format="multipart").status_code == 400
    ok = SimpleUploadedFile("me.png", PNG, content_type="image/png")
    assert alice.post(url, {"photo": ok}, format="multipart").status_code == 200

    res = alice.get(f"/api/employees/{org['alice'].id}/photo/")
    assert res.status_code == 200
    assert res["Cache-Control"].startswith("private, max-age=")  # the user's own browser only
    assert b"".join(res.streaming_content).startswith(b"\x89PNG")
    # colleagues see it (messages, groups, directory) without uploading anything themselves
    res = client_for(org["carol"]).get(f"/api/employees/{org['alice'].id}/photo/")
    assert res.status_code == 200 and b"".join(res.streaming_content).startswith(b"\x89PNG")
    # but cannot replace it
    other = SimpleUploadedFile("x.png", PNG, content_type="image/png")
    res = client_for(org["bob"]).post(f"/api/employees/{org['alice'].id}/photo/", {"photo": other}, format="multipart")
    assert res.status_code == 404


def test_profile_photos_are_visible_to_colleagues_but_documents_stay_private(org, client_for):
    alice = client_for(org["alice"])
    alice.post(f"/api/employees/{org['alice'].id}/photo/",
               {"photo": SimpleUploadedFile("me.png", PNG, content_type="image/png")}, format="multipart")
    version = alice.get("/api/auth/me/").data["employee"]["photo_version"]
    assert version
    # The messaging directory tells colleagues there is a photo and which version.
    people = client_for(org["carol"]).get("/api/messages/people/", {"q": org["alice"].user.first_name}).data["results"]
    card = next(p for p in people if p["employee_id"] == org["alice"].id)
    assert card["has_photo"] is True and card["photo_version"] == version
    # A new photo gets a new version, so browsers do not keep showing the old one.
    alice.post(f"/api/employees/{org['alice'].id}/photo/",
               {"photo": SimpleUploadedFile("new.png", PNG, content_type="image/png")}, format="multipart")
    assert alice.get("/api/auth/me/").data["employee"]["photo_version"] != version
    # The rest of the employee record is still out of scope for colleagues.
    assert client_for(org["carol"]).get(f"/api/employees/{org['alice'].id}/").status_code == 404


def test_no_photo_means_the_default_avatar(org, client_for):
    carol = client_for(org["carol"])
    assert carol.get(f"/api/employees/{org['bob'].id}/photo/").status_code == 404
    me = client_for(org["bob"]).get("/api/auth/me/").data["employee"]
    assert me["has_photo"] is False and me["photo_version"] is None


def test_former_employees_photo_only_within_hr_scope(org, client_for):
    alice = client_for(org["alice"])
    alice.post(f"/api/employees/{org['alice'].id}/photo/",
               {"photo": SimpleUploadedFile("me.png", PNG, content_type="image/png")}, format="multipart")
    Employee.objects.filter(pk=org["alice"].pk).update(employment_status="EXITED")  # keep the uploaded photo
    assert client_for(org["carol"]).get(f"/api/employees/{org['alice'].id}/photo/").status_code == 404
    assert client_for(org["hr"]).get(f"/api/employees/{org['alice'].id}/photo/").status_code == 200
