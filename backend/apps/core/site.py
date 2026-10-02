"""Site-level endpoints: health check and a friendly root redirect."""

from django.conf import settings
from django.db import connection
from django.http import HttpResponseRedirect
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """Liveness + database check. Used by the start script and monitoring."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            database = "ok"
        except Exception:  # noqa: BLE001 - report, never raise, from a health check
            database = "unavailable"
        status = 200 if database == "ok" else 503
        return Response({"service": "nexvra-hrms-api", "status": "ok" if status == 200 else "degraded",
                         "database": database}, status=status)


def root_redirect(request):
    """Port 8000 only serves the API; send people who open it in a browser to the app."""
    return HttpResponseRedirect(settings.FRONTEND_URL)
