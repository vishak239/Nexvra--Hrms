from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.site import HealthView, root_redirect

api_patterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include("apps.accounts.urls_auth")),
    path("", include("apps.accounts.urls")),
    path("", include("apps.organization.urls")),
    path("employees/", include("apps.employees.urls")),
    path("attendance/", include("apps.attendance.urls")),
    path("leaves/", include("apps.leaves.urls")),
    path("payroll/", include("apps.payroll.urls")),
    path("documents/", include("apps.documents.urls")),
    path("notifications/", include("apps.notifications.urls")),
    path("tasks/", include("apps.tasks.urls")),
    path("messages/", include("apps.messaging.urls")),
    path("audit-logs/", include("apps.audit.urls")),
    path("", include("apps.reports.urls")),
]
if settings.DEBUG:
    # API schema + Swagger UI are development aids only.
    api_patterns += [
        path("schema/", SpectacularAPIView.as_view(), name="schema"),
        path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger"),
    ]

urlpatterns = [
    path("", root_redirect, name="root"),
    path("api/", include(api_patterns)),
]

if settings.DJANGO_ADMIN_ENABLED:
    urlpatterns.append(path("django-admin/", admin.site.urls))
