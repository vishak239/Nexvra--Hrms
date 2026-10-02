from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("", views.AttendanceViewSet, basename="attendance")

urlpatterns = router.urls
