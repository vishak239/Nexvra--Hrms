from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("departments", views.DepartmentViewSet, basename="department")
router.register("designations", views.DesignationViewSet, basename="designation")
router.register("holidays", views.HolidayViewSet, basename="holiday")
router.register("policies", views.PolicyViewSet, basename="policy")

urlpatterns = [
    path("company/", views.CompanyView.as_view(), name="company"),
    path("settings/", views.SettingsView.as_view(), name="settings"),
    *router.urls,
]
