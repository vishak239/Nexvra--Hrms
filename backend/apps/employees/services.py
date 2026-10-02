from django.db import transaction

from apps.accounts import services as account_services
from apps.accounts.models import User
from apps.audit import services as audit
from apps.organization.models import CompanySettings

from .models import Employee

EMPLOYEE_AUDIT_FIELDS = [
    "employee_code",
    "phone",
    "joining_date",
    "exit_date",
    "department_id",
    "designation_id",
    "manager_id",
    "employment_type",
    "employment_status",
    "address",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relation",
]
USER_AUDIT_FIELDS = ["email", "first_name", "last_name", "role_id", "is_active"]


@transaction.atomic
def create_employee(request, data):
    actor = request.user
    data = dict(data)
    role = data.pop("role")
    account_services.assert_can_assign_role(actor, role)
    password = data.pop("initial_password", "") or None
    user_fields = {f: data.pop(f) for f in ("email", "first_name", "last_name", "is_active") if f in data}
    user = User.objects.create_user(password=password, role=role, must_change_password=bool(password), **user_fields)
    employee = Employee.objects.create(user=user, **data)
    if not password:
        account_services.send_password_setup_email(user, reset=False)
    audit.record(
        request,
        "EMPLOYEE_CREATED",
        obj=employee,
        changes=audit.snapshot(employee, EMPLOYEE_AUDIT_FIELDS),
        metadata={"email": user.email, "role": role.code},
    )
    return employee


@transaction.atomic
def update_employee(request, employee, data):
    actor = request.user
    data = dict(data)
    user = employee.user
    account_services.assert_can_edit_user(actor, user, data.get("role"), data.get("is_active"))

    before = {
        **audit.snapshot(employee, EMPLOYEE_AUDIT_FIELDS),
        **audit.snapshot(user, USER_AUDIT_FIELDS),
    }
    for field in ("email", "first_name", "last_name", "role", "is_active"):
        if field in data:
            setattr(user, field, data.pop(field))
    for field, value in data.items():
        setattr(employee, field, value)

    if (
        employee.employment_status == Employee.Status.EXITED
        and before["employment_status"] != Employee.Status.EXITED
        and CompanySettings.get_solo().deactivate_user_on_exit
        and user.pk != actor.pk
    ):
        user.is_active = False

    user.save()
    employee.save()
    after = {**audit.snapshot(employee, EMPLOYEE_AUDIT_FIELDS), **audit.snapshot(user, USER_AUDIT_FIELDS)}
    audit.record(request, "EMPLOYEE_UPDATED", obj=employee, changes=audit.diff(before, after))
    return employee


@transaction.atomic
def self_update(request, employee, data):
    before = audit.snapshot(employee, list(data))
    for field, value in data.items():
        setattr(employee, field, value)
    employee.save()
    audit.record(request, "EMPLOYEE_SELF_UPDATED", obj=employee, changes=audit.diff(before, dict(data)))
    return employee
