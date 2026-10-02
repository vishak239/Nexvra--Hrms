import pytest

from apps.accounts.models import User
from apps.employees.models import Employee

pytestmark = pytest.mark.django_db


def test_username_generated_from_email_and_unique(make_user):
    first = make_user(email="Jane.Doe@example.test")
    second = make_user(email="jane.doe@other.test")
    assert first.username == "jane.doe"
    assert second.username == "jane.doe2"
    assert make_user(email="ab@example.test").username == "userab"


def test_hr_sets_and_changes_username_on_employee(org, client_for):
    hr = client_for(org["hr"])
    res = hr.post(
        "/api/employees/",
        {"email": "new.person@example.test", "first_name": "New", "employee_code": "U-1", "joining_date": "2024-01-01",
         "employment_type": "FULL_TIME", "username": "@New_Person"},
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["username"] == "new_person"
    employee = Employee.objects.get(pk=res.data["id"])
    res = hr.patch(f"/api/employees/{employee.id}/", {"username": org["alice"].user.username}, format="json")
    assert res.status_code == 400 and "username" in res.data["error"]["fields"]
    res = hr.patch(f"/api/employees/{employee.id}/", {"username": "x"}, format="json")
    assert res.status_code == 400
    res = hr.patch(f"/api/employees/{employee.id}/", {"username": "renamed"}, format="json")
    assert res.status_code == 200 and res.data["username"] == "renamed"
    assert User.objects.get(pk=employee.user_id).username == "renamed"


def test_username_in_profile_and_search(org, client_for):
    alice = org["alice"]
    me = client_for(alice).get("/api/auth/me/").data
    assert me["username"] == alice.user.username
    found = client_for(org["hr"]).get("/api/employees/", {"search": alice.user.username}).data["results"]
    assert [e["id"] for e in found] == [alice.id]


def test_initial_password_must_not_resemble_the_username(org, client_for):
    res = client_for(org["hr"]).post(
        "/api/employees/",
        {"email": "pw.check@example.test", "first_name": "Pw", "employee_code": "U-2", "joining_date": "2024-01-01",
         "employment_type": "FULL_TIME", "username": "kumaravel", "initial_password": "kumaravel1!"},
        format="json",
    )
    assert res.status_code == 400
    assert "too similar" in res.data["error"]["message"]
