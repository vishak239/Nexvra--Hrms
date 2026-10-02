from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("types", views.LeaveTypeViewSet, basename="leave-type")
router.register("balances", views.LeaveBalanceViewSet, basename="leave-balance")
router.register("requests", views.LeaveRequestViewSet, basename="leave-request")

urlpatterns = router.urls
