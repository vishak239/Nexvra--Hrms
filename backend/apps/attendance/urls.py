from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
# Specific prefixes first so the records' detail route cannot capture them.
router.register("breaks", views.BreakViewSet, basename="attendance-break")
router.register("overtime", views.OvertimeViewSet, basename="attendance-overtime")
router.register("sync-events", views.SyncEventViewSet, basename="attendance-sync-event")
router.register("wfh", views.WorkFromHomeViewSet, basename="attendance-wfh")
router.register("meetings", views.MeetingViewSet, basename="attendance-meeting")
router.register("resume-requests", views.ResumeWorkRequestViewSet, basename="attendance-resume")
router.register("", views.AttendanceViewSet, basename="attendance")

urlpatterns = router.urls
