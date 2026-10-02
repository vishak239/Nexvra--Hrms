"""Development/demo data ONLY. Every value here is fictional and clearly labelled "Demo";
none of it represents a Nexvra HR policy. Refuses to run when DEBUG is off."""

import datetime
import os
import secrets
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Role, User
from apps.employees.models import Employee
from apps.leaves.models import LeaveBalance, LeaveType
from apps.organization.models import Department, Designation
from apps.payroll.models import PayComponent, SalaryStructure, SalaryStructureItem

PEOPLE = [
    # email, first, last, role, code, department, designation, manager email
    ("superadmin@example.test", "Demo", "SuperAdmin", "SUPER_ADMIN", "DEMO-001", None, None, None),
    ("hr@example.test", "Demo", "HR", "HR_ADMIN", "DEMO-002", "DEMO-HR", "Demo HR Executive", None),
    ("manager@example.test", "Demo", "Manager", "MANAGER", "DEMO-003", "DEMO-ENG", "Demo Team Lead", None),
    ("employee@example.test", "Demo", "Employee", "EMPLOYEE", "DEMO-004", "DEMO-ENG", "Demo Engineer",
     "manager@example.test"),
    ("employee2@example.test", "Demo", "Employee Two", "EMPLOYEE", "DEMO-005", "DEMO-ENG", "Demo Engineer",
     "manager@example.test"),
    ("outsider@example.test", "Demo", "Outsider", "EMPLOYEE", "DEMO-006", "DEMO-HR", "Demo HR Executive", None),
]

USERNAMES = {
    "superadmin@example.test": "demo.superadmin",
    "hr@example.test": "demo.hr",
    "manager@example.test": "demo.manager",
    "employee@example.test": "demo.employee",
    "employee2@example.test": "demo.employee2",
    "outsider@example.test": "demo.outsider",
}


class Command(BaseCommand):
    help = "Seed fictional demo data for local development (DEBUG only)."

    def add_arguments(self, parser):
        parser.add_argument("--password", help="Password for all demo users (or env DEMO_USER_PASSWORD).")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DJANGO_DEBUG=True.")
        password = options["password"] or os.environ.get("DEMO_USER_PASSWORD")
        generated = not password
        password = password or secrets.token_urlsafe(12)

        depts = {
            "DEMO-ENG": Department.objects.get_or_create(code="DEMO-ENG", defaults={"name": "Demo Engineering"})[0],
            "DEMO-HR": Department.objects.get_or_create(code="DEMO-HR", defaults={"name": "Demo People Ops"})[0],
        }
        employees = {}
        for email, first, last, role, code, dept, desig, _manager in PEOPLE:
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(
                    email=email, password=password, first_name=first, last_name=last, role=Role.objects.get(code=role)
                )
                if role == "SUPER_ADMIN":
                    user.is_staff = user.is_superuser = True
                    user.save()
            else:
                user.set_password(password)
                user.save()
            handle = USERNAMES[email]
            if user.username != handle and not User.objects.filter(username=handle).exclude(pk=user.pk).exists():
                user.username = handle
                user.save(update_fields=["username"])
            designation = Designation.objects.get_or_create(name=desig)[0] if desig else None
            emp, _ = Employee.objects.get_or_create(
                user=user,
                defaults={
                    "employee_code": code,
                    "joining_date": datetime.date(2024, 1, 1),
                    "employment_type": Employee.EmploymentType.FULL_TIME,
                    "department": depts.get(dept),
                    "designation": designation,
                },
            )
            employees[email] = emp
        for email, *_, manager in PEOPLE:
            if manager:
                emp = employees[email]
                emp.manager = employees[manager]
                emp.save(update_fields=["manager"])

        demo_leave, _ = LeaveType.objects.get_or_create(
            code="DEMO-AL", defaults={"name": "Demo Annual Leave", "annual_allocation": Decimal("12"),
                                      "allow_half_day": True,
                                      "description": "Demo only. Not a Nexvra policy."}
        )
        LeaveType.objects.get_or_create(
            code="DEMO-UL", defaults={"name": "Demo Unpaid Leave", "is_paid": False,
                                      "description": "Demo only. Balance not tracked."}
        )
        today = datetime.date.today()
        for emp in employees.values():
            for year in (today.year, today.year + 1):
                LeaveBalance.objects.get_or_create(
                    employee=emp, leave_type=demo_leave, year=year, defaults={"allocated": Decimal("12")}
                )

        base = PayComponent.objects.get_or_create(code="DEMO-BASE", defaults={"name": "Demo Base Pay",
                                                                               "kind": "EARNING"})[0]
        deduction = PayComponent.objects.get_or_create(code="DEMO-DED", defaults={"name": "Demo Deduction",
                                                                                   "kind": "DEDUCTION"})[0]
        for emp in employees.values():
            structure, created = SalaryStructure.objects.get_or_create(
                employee=emp, effective_from=datetime.date(2024, 1, 1)
            )
            if created:
                SalaryStructureItem.objects.create(structure=structure, component=base, amount=Decimal("1000.00"))
                SalaryStructureItem.objects.create(structure=structure, component=deduction, amount=Decimal("50.00"))

        self.stdout.write(self.style.SUCCESS("Demo data ready. Users:"))
        for email, _first, _last, role, *_ in PEOPLE:
            self.stdout.write(f"  {email}  @{USERNAMES[email]}  ({role})")
        if generated:
            self.stdout.write(self.style.WARNING(f"Generated password for all demo users: {password}"))
