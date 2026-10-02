import csv
import datetime

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.attendance import services as attendance
from apps.attendance.models import AttendanceRecord, BreakSession, OvertimeSession, SessionStatus
from apps.attendance.serializers import AttendanceRecordSerializer
from apps.core.permissions import HasPermission, scope_queryset
from apps.employees.models import Employee
from apps.leaves import services as leave_services
from apps.leaves.models import LeaveRequest
from apps.messaging import services as messaging
from apps.notifications.models import Notification
from apps.organization.models import CompanySettings, Holiday
from apps.payroll.models import PayrollRun, Payslip
from apps.tasks import rules as task_rules
from apps.tasks.models import Task

from . import services

REPORT_PERMS = ("reports.view_team", "reports.view_all")


def _date_param(request, name, default):
    raw = request.query_params.get(name)
    if not raw:
        return default
    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({name: ["Use YYYY-MM-DD."]}) from None


def _csv(filename, header, rows):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "private, no-store"
    writer = csv.writer(response)
    writer.writerow(header)
    for row in rows:
        # Neutralise spreadsheet formula injection.
        writer.writerow([f"'{v}" if isinstance(v, str) and v[:1] in "=+-@" else v for v in row])
    return response


def _wants_csv(request):
    return request.query_params.get("export") == "csv"


class ReportView(APIView):
    permission_classes = [HasPermission]
    required_permissions = {"get": REPORT_PERMS}

    def employees(self):
        return scope_queryset(Employee.objects.all(), self.request.user, "reports", employee_path="")


class HeadcountReportView(ReportView):
    def get(self, request):
        data = services.headcount(self.employees())
        if _wants_csv(request):
            rows = [("department", r["label"] or "Unassigned", r["count"]) for r in data["by_department"]]
            rows += [("status", r["label"], r["count"]) for r in data["by_status"]]
            rows += [("employment_type", r["label"], r["count"]) for r in data["by_employment_type"]]
            return _csv("headcount.csv", ["group", "value", "count"], rows)
        return Response(data)


class AttendanceSummaryReportView(ReportView):
    def get(self, request):
        cs = CompanySettings.get_solo()
        today = cs.today()
        start = _date_param(request, "date_from", today.replace(day=1))
        end = _date_param(request, "date_to", today)
        if end < start:
            raise ValidationError({"date_to": ["Must be on or after date_from."]})
        if (end - start).days >= services.MAX_RANGE_DAYS:
            raise ValidationError({"date_to": [f"Range is limited to {services.MAX_RANGE_DAYS} days."]})
        employees = self.employees()
        department = request.query_params.get("department")
        if department and department.isdigit():
            employees = employees.filter(department_id=int(department))
        rows = services.attendance_summary(employees, start, end, cs)
        if _wants_csv(request):
            keys = ["employee_code", "full_name", "department", "present", "half_day", "absent", "late",
                    "on_leave", "holiday", "weekly_off", "not_marked"]
            return _csv(f"attendance_{start}_{end}.csv", keys, [[r[k] for k in keys] for r in rows])
        return Response({"date_from": start, "date_to": end, "results": rows})


class LeaveSummaryReportView(ReportView):
    def get(self, request):
        cs = CompanySettings.get_solo()
        year = request.query_params.get("year")
        year = int(year) if year and year.isdigit() else cs.leave_year_for(cs.today())
        data = services.leave_summary(self.employees(), year)
        if _wants_csv(request):
            keys = ["employee_code", "full_name", "leave_type", "days"]
            return _csv(f"leave_{year}.csv", keys, [[r[k] for k in keys] for r in data["approved_by_employee"]])
        return Response(data)


class PayrollSummaryReportView(APIView):
    permission_classes = [HasPermission]
    required_permissions = {"get": ("payroll.view_all",)}

    def get(self, request):
        run_id = request.query_params.get("run")
        if run_id and run_id.isdigit():
            run = get_object_or_404(PayrollRun, pk=int(run_id))
        else:
            run = PayrollRun.objects.order_by("-year", "-month").first()
            if run is None:
                return Response({"run": None})
        data = services.payroll_summary(run)
        if _wants_csv(request):
            rows = [[r["department"] or "Unassigned", r["count"], r["gross"], r["net"]] for r in data["by_department"]]
            return _csv(f"payroll_{run.year}_{run.month:02d}.csv", ["department", "payslips", "gross", "net"], rows)
        return Response(data)


class DashboardView(APIView):
    """Role-aware summary built only from real data; sections depend on permissions."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        cs = CompanySettings.get_solo()
        today = cs.today()
        employee = Employee.objects.filter(user=user).first()
        data = {
            "date": today,
            "unread_notifications": Notification.objects.filter(recipient=user, is_read=False).count(),
            "upcoming_holidays": list(
                Holiday.objects.filter(date__gte=today).order_by("date").values("id", "date", "name", "is_optional")[:5]
            ),
        }

        if user.has_permission("messages.use"):
            data["unread_messages"] = messaging.unread_total(user)

        if employee is not None:
            record = AttendanceRecord.objects.filter(employee=employee, date=today).first()
            year = cs.leave_year_for(today)
            balances = []
            for leave_type in leave_services.active_types():
                summary = leave_services.balance_summary(employee, leave_type, year)
                if summary is not None:
                    balances.append({"leave_type": leave_type.name, **summary})
            latest = (
                Payslip.objects.filter(employee=employee, run__status=PayrollRun.Status.FINALIZED)
                .select_related("run")
                .order_by("-run__year", "-run__month")
                .first()
            )
            data["me"] = {
                "attendance_today": AttendanceRecordSerializer(record).data if record else None,
                "self_attendance_enabled": cs.self_attendance_enabled,
                "leave_year": year,
                "leave_balances": balances,
                "pending_leave_requests": LeaveRequest.objects.filter(
                    employee=employee, status=LeaveRequest.Status.PENDING
                ).count(),
                "open_tasks": Task.objects.filter(assigned_to=employee, status__in=Task.OPEN_STATUSES).count(),
                "blocking_tasks": task_rules.blocking_tasks(user).count(),
                "latest_payslip": (
                    {"id": latest.id, "year": latest.run.year, "month": latest.run.month, "net_pay": latest.net_pay,
                     "currency": latest.run.currency}
                    if latest and user.has_permission("payroll.view_own")
                    else None
                ),
            }

        if user.has_permission("leave.approve_all") or user.has_permission("leave.approve_team"):
            pending = LeaveRequest.objects.filter(status=LeaveRequest.Status.PENDING).exclude(employee__user=user)
            if not user.has_permission("leave.approve_all"):
                pending = pending.filter(employee__manager__user=user)
            data["pending_approvals"] = pending.count()

        if user.has_permission("attendance.view_all") or user.has_permission("attendance.view_team"):
            people = scope_queryset(
                Employee.objects.exclude(employment_status=Employee.Status.EXITED), user, "attendance", ""
            )
            if not user.has_permission("attendance.view_all"):
                people = people.exclude(user=user)
            rows = attendance.daily_status(list(people), today, cs)
            counts = {}
            for row in rows:
                counts[row["status"]] = counts.get(row["status"], 0) + 1
            late = sum(1 for row in rows if row["record"] is not None and row["record"].is_late)
            data["attendance_today"] = {"total": len(rows), "by_status": counts, "late": late}

        if user.has_permission("attendance.view_all") or user.has_permission("attendance.view_team"):
            breaks = scope_queryset(BreakSession.objects.filter(status=SessionStatus.ACTIVE), user, "attendance")
            overtime = scope_queryset(OvertimeSession.objects.filter(status=SessionStatus.ACTIVE), user, "attendance")
            data["work_sessions_now"] = {
                "on_break": breaks.exclude(employee__user=user).count(),
                "overtime_running": overtime.exclude(employee__user=user).count(),
            }

        if user.has_permission("tasks.view_all") or user.has_permission("tasks.view_team"):
            tasks = scope_queryset(
                Task.objects.filter(status__in=Task.OPEN_STATUSES), user, "tasks", employee_path="assigned_to"
            ).exclude(assigned_to__user=user)
            data["tasks_overview"] = {
                "open": tasks.count(),
                "overdue": tasks.filter(due_date__lt=today).count(),
                "awaiting_response": tasks.filter(requires_response=True, responded_at__isnull=True).count(),
            }

        if user.has_permission("employees.view_all"):
            data["headcount"] = Employee.objects.exclude(employment_status=Employee.Status.EXITED).count()
        elif user.has_permission("employees.view_team"):
            data["team_size"] = Employee.objects.filter(manager__user=user).exclude(
                employment_status=Employee.Status.EXITED
            ).count()

        if user.has_permission("payroll.view_all"):
            run = PayrollRun.objects.order_by("-year", "-month").first()
            data["latest_payroll_run"] = (
                {"id": run.id, "year": run.year, "month": run.month, "status": run.status} if run else None
            )
        return Response(data)
