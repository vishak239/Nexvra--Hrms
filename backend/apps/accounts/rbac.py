"""Permission catalogue and default role matrix (see docs/architecture.md §5).

`sync_rbac` is idempotent. It creates missing permissions and roles, and grants a newly
created permission to the roles that hold it by default. It never removes a permission
an administrator has deliberately granted or revoked on an existing role.
"""

SUPER_ADMIN = "SUPER_ADMIN"
HR_ADMIN = "HR_ADMIN"
MANAGER = "MANAGER"
EMPLOYEE = "EMPLOYEE"

PERMISSIONS = {
    "company.manage": "Edit the company profile",
    "settings.manage": "Edit HR policy settings",
    "users.view": "View user accounts",
    "users.manage": "Create and edit user accounts",
    "roles.view": "View roles and permissions",
    "roles.manage": "Edit roles and their permissions",
    "audit.view": "View the audit log",
    "departments.manage": "Create and edit departments",
    "designations.manage": "Create and edit designations",
    "holidays.manage": "Manage the holiday calendar",
    "employees.view_team": "View direct reports",
    "employees.view_all": "View all employees",
    "employees.manage": "Create and edit employees",
    "attendance.self": "Check in and check out",
    "attendance.view_team": "View team attendance",
    "attendance.view_all": "View all attendance",
    "attendance.manage": "Create and correct attendance records",
    "leave.apply": "Apply for leave",
    "leave.view_team": "View team leave",
    "leave.approve_team": "Approve or reject team leave",
    "leave.view_all": "View all leave",
    "leave.approve_all": "Approve or reject any leave",
    "leave.manage_types": "Manage leave types",
    "leave.manage_balances": "Manage leave balances",
    "payroll.view_own": "View own payslips",
    "payroll.view_all": "View all payroll data",
    "payroll.manage": "Manage salaries and run payroll",
    "documents.view_own": "View own shared documents",
    "documents.view_all": "View all employee documents",
    "documents.manage": "Upload and delete employee documents",
    "reports.view_team": "View team reports",
    "reports.view_all": "View company-wide HR reports",
    "tasks.view_team": "View tasks assigned to direct reports",
    "tasks.view_all": "View all tasks",
    "tasks.manage": "Assign, edit, remind and cancel tasks",
    "messages.use": "Send and receive private messages and files",
    "policies.manage": "Create, edit and publish company policies",
}

_EMPLOYEE = {"attendance.self", "leave.apply", "payroll.view_own", "documents.view_own", "messages.use"}
_MANAGER = _EMPLOYEE | {
    "employees.view_team",
    "attendance.view_team",
    "leave.view_team",
    "leave.approve_team",
    "reports.view_team",
    "tasks.view_team",
}
_HR = _MANAGER | {
    "employees.view_all",
    "employees.manage",
    "attendance.view_all",
    "attendance.manage",
    "leave.view_all",
    "leave.approve_all",
    "leave.manage_types",
    "leave.manage_balances",
    "holidays.manage",
    "departments.manage",
    "designations.manage",
    "payroll.view_all",
    "payroll.manage",
    "documents.view_all",
    "documents.manage",
    "reports.view_all",
    "settings.manage",
    "tasks.view_all",
    "tasks.manage",
    "policies.manage",
}

# code: (name, level, default permissions)
ROLES = {
    SUPER_ADMIN: ("Super Admin", 100, set(PERMISSIONS)),
    HR_ADMIN: ("HR Admin", 50, _HR),
    MANAGER: ("Manager", 20, _MANAGER),
    EMPLOYEE: ("Employee", 10, _EMPLOYEE),
}


def sync_rbac(Permission, Role):
    """Takes model classes so it can run inside migrations (historical models)."""
    new_codes = set()
    for code, description in PERMISSIONS.items():
        _, created = Permission.objects.update_or_create(codename=code, defaults={"description": description})
        if created:
            new_codes.add(code)
    for code, (name, level, defaults) in ROLES.items():
        role, created = Role.objects.get_or_create(
            code=code, defaults={"name": name, "level": level, "is_system": True}
        )
        grant = defaults if created else defaults & new_codes
        if grant:
            role.permissions.add(*Permission.objects.filter(codename__in=grant))
