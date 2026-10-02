from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view(), name="dashboard"),
    path("reports/headcount/", views.HeadcountReportView.as_view(), name="report-headcount"),
    path("reports/attendance-summary/", views.AttendanceSummaryReportView.as_view(), name="report-attendance"),
    path("reports/leave-summary/", views.LeaveSummaryReportView.as_view(), name="report-leave"),
    path("reports/payroll-summary/", views.PayrollSummaryReportView.as_view(), name="report-payroll"),
]
