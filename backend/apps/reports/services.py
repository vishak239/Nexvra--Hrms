import datetime
from collections import Counter, defaultdict
from decimal import Decimal

from django.db.models import Count, Sum

from apps.attendance import services as attendance
from apps.attendance.models import AttendanceRecord
from apps.employees.models import Employee
from apps.leaves.models import LeaveRequest
from apps.organization.models import Holiday
from apps.payroll.models import Payslip

MAX_RANGE_DAYS = 93


def headcount(employees):
    current = employees.exclude(employment_status=Employee.Status.EXITED)

    def grouped(qs, field, label_field=None):
        rows = qs.values(field, *( [label_field] if label_field else [])).annotate(count=Count("id")).order_by(field)
        return [
            {"key": r[field], "label": r[label_field] if label_field else r[field], "count": r["count"]} for r in rows
        ]

    return {
        "total_current": current.count(),
        "by_status": grouped(employees, "employment_status"),
        "by_department": grouped(current, "department_id", "department__name"),
        "by_employment_type": grouped(current, "employment_type"),
    }


def attendance_summary(employees, start, end, cs):
    employees = list(employees.select_related("user", "department"))
    ids = [e.id for e in employees]
    records = {
        (r.employee_id, r.date): r
        for r in AttendanceRecord.objects.filter(employee_id__in=ids, date__range=(start, end))
    }
    on_leave = set()
    for leave in LeaveRequest.objects.filter(
        employee_id__in=ids, status=LeaveRequest.Status.APPROVED, start_date__lte=end, end_date__gte=start
    ):
        day = max(leave.start_date, start)
        while day <= min(leave.end_date, end):
            on_leave.add((leave.employee_id, day))
            day += datetime.timedelta(days=1)
    holidays = set(
        Holiday.objects.filter(date__range=(start, end), is_optional=False).values_list("date", flat=True)
    )
    today = cs.today()

    rows = []
    for emp in employees:
        counts = Counter()
        day = start
        while day <= end:
            if attendance.employed_on(emp, day):
                record = records.get((emp.id, day))
                counts[attendance.classify(day, record, (emp.id, day) in on_leave, day in holidays, cs, today)] += 1
                if record is not None and record.is_late:
                    counts["LATE"] += 1
            day += datetime.timedelta(days=1)
        rows.append(
            {
                "employee_id": emp.id,
                "employee_code": emp.employee_code,
                "full_name": emp.user.full_name,
                "department": emp.department.name if emp.department_id else None,
                "present": counts[AttendanceRecord.Status.PRESENT],
                "half_day": counts[AttendanceRecord.Status.HALF_DAY],
                "absent": counts[AttendanceRecord.Status.ABSENT],
                "late": counts["LATE"],
                "on_leave": counts[attendance.ON_LEAVE],
                "holiday": counts[attendance.HOLIDAY],
                "weekly_off": counts[attendance.WEEKLY_OFF],
                "not_marked": counts[attendance.NOT_MARKED],
            }
        )
    return rows


def leave_summary(employees, year):
    qs = LeaveRequest.objects.filter(employee__in=employees, leave_year=year)
    by_type = defaultdict(lambda: {"requests": Counter(), "approved_days": Decimal("0")})
    for row in qs.values("leave_type__name", "status").annotate(n=Count("id"), days=Sum("days")):
        entry = by_type[row["leave_type__name"]]
        entry["requests"][row["status"]] = row["n"]
        if row["status"] == LeaveRequest.Status.APPROVED:
            entry["approved_days"] = row["days"]
    per_employee = (
        qs.filter(status=LeaveRequest.Status.APPROVED)
        .values("employee_id", "employee__employee_code", "employee__user__first_name", "employee__user__last_name",
                "leave_type__name")
        .annotate(days=Sum("days"))
        .order_by("employee__employee_code", "leave_type__name")
    )
    return {
        "year": year,
        "by_type": [
            {"leave_type": name, "requests": dict(v["requests"]), "approved_days": v["approved_days"]}
            for name, v in sorted(by_type.items())
        ],
        "approved_by_employee": [
            {
                "employee_id": r["employee_id"],
                "employee_code": r["employee__employee_code"],
                "full_name": f"{r['employee__user__first_name']} {r['employee__user__last_name']}".strip(),
                "leave_type": r["leave_type__name"],
                "days": r["days"],
            }
            for r in per_employee
        ],
    }


def payroll_summary(run):
    payslips = Payslip.objects.filter(run=run)
    totals = payslips.aggregate(
        gross=Sum("gross_earnings"), deductions=Sum("total_deductions"), net=Sum("net_pay"), count=Count("id")
    )
    by_department = (
        payslips.values("employee__department__name")
        .annotate(count=Count("id"), gross=Sum("gross_earnings"), net=Sum("net_pay"))
        .order_by("employee__department__name")
    )
    return {
        "run": run.id,
        "year": run.year,
        "month": run.month,
        "status": run.status,
        "currency": run.currency,
        "payslips": totals["count"],
        "gross_earnings": totals["gross"] or Decimal("0"),
        "total_deductions": totals["deductions"] or Decimal("0"),
        "net_pay": totals["net"] or Decimal("0"),
        "by_department": [
            {"department": r["employee__department__name"], "count": r["count"], "gross": r["gross"], "net": r["net"]}
            for r in by_department
        ],
    }
