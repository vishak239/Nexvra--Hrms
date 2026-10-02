from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("components", views.PayComponentViewSet, basename="pay-component")
router.register("salary-structures", views.SalaryStructureViewSet, basename="salary-structure")
router.register("runs", views.PayrollRunViewSet, basename="payroll-run")
router.register("payslips", views.PayslipViewSet, basename="payslip")

urlpatterns = router.urls
