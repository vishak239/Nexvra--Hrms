import datetime
import itertools

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.accounts.rbac import EMPLOYEE, HR_ADMIN, MANAGER, SUPER_ADMIN
from apps.employees.models import Employee
from apps.organization.models import CompanySettings, Department, Designation

PASSWORD = "Str0ng-test-pass!"
_seq = itertools.count(1)


@pytest.fixture(autouse=True)
def _rbac_seeded(request):
    """Transactional tests (real concurrency) flush the tables, including the roles and
    permissions that migrations seed. Re-seed them (idempotently) when missing."""
    if request.node.get_closest_marker("django_db") is None and "db" not in request.fixturenames:
        return
    request.getfixturevalue("db")  # honours a transaction=True marker
    from apps.accounts.models import Permission
    from apps.accounts.rbac import sync_rbac
    from apps.organization.models import Company

    # Checked separately: a reused test DB may have been flushed and then partly re-seeded
    # by a newer data migration (e.g. roles only).
    if not Role.objects.exists():
        sync_rbac(Permission, Role)
    if not Company.objects.filter(pk=1).exclude(name="").exists():
        Company.objects.update_or_create(pk=1, defaults={"name": "Nexvra Solutions"})


@pytest.fixture(autouse=True)
def _test_env(settings, tmp_path):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    settings.STORAGES = {
        **settings.STORAGES,
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": tmp_path / "private_media"},
        },
    }
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def make_user(db):
    def _make(role=EMPLOYEE, email=None, password=PASSWORD, **extra):
        n = next(_seq)
        return User.objects.create_user(
            email=email or f"user{n}@example.test",
            password=password,
            first_name=extra.pop("first_name", f"User{n}"),
            last_name=extra.pop("last_name", "Test"),
            role=Role.objects.get(code=role),
            **extra,
        )

    return _make


@pytest.fixture
def make_employee(make_user):
    def _make(role=EMPLOYEE, manager=None, user=None, **fields):
        user = user or make_user(role=role)
        n = next(_seq)
        fields.setdefault("employee_code", f"EMP{n:04d}")
        fields.setdefault("joining_date", datetime.date(2024, 1, 1))
        fields.setdefault("employment_type", Employee.EmploymentType.FULL_TIME)
        return Employee.objects.create(user=user, manager=manager, **fields)

    return _make


@pytest.fixture
def org(db, make_employee):
    """A small organisation:

    super_admin
    hr            (HR_ADMIN)
    manager       (MANAGER) -> alice, bob (direct reports)
    other_manager (MANAGER) -> carol
    """
    dept = Department.objects.create(name="Engineering", code="ENG")
    desig = Designation.objects.create(name="Engineer")
    people = {}
    people["super_admin"] = make_employee(role=SUPER_ADMIN)
    people["hr"] = make_employee(role=HR_ADMIN)
    people["manager"] = make_employee(role=MANAGER, department=dept, designation=desig)
    people["other_manager"] = make_employee(role=MANAGER)
    people["alice"] = make_employee(manager=people["manager"], department=dept, designation=desig,
                                    phone="+10000000001", address="1 Private Road")
    people["bob"] = make_employee(manager=people["manager"], department=dept)
    people["carol"] = make_employee(manager=people["other_manager"])
    people["department"] = dept
    people["designation"] = desig
    return people


@pytest.fixture
def client_for():
    def _client(who):
        user = who.user if isinstance(who, Employee) else who
        client = APIClient()
        client.force_login(user)
        return client

    return _client


@pytest.fixture
def anon():
    return APIClient()


@pytest.fixture
def configure():
    def _configure(**values):
        cs = CompanySettings.get_solo()
        for key, value in values.items():
            setattr(cs, key, value)
        cs.save()
        return cs

    return _configure
