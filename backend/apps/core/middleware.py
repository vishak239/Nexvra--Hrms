"""Session lifetime that follows real use.

Root cause of the "everyone is checked out around 6 PM" bug (production, October 2026): the
session cookie lived exactly SESSION_COOKIE_AGE (8 hours) from sign-in and was never extended.
People who signed in at 9-10 AM were signed out at 5-6 PM while still working; their browser then
stopped reporting activity, so the 30-minute inactivity rule checked them out.

Now the 8 hours are an *idle* limit: every authenticated request that reflects use restarts it.
The session row is rewritten at most once per SESSION_RENEW_SECONDS, not on every request.
Background polls (the notification badge, the work-session state refresh, unread counters) do
not count as use, so a browser left open and unattended still signs out after 8 idle hours.
"""

from django.conf import settings
from django.utils import timezone

RENEWED_AT_KEY = "_renewed_at"

# GET requests the app makes on a timer, without the user doing anything.
PASSIVE_PATHS = frozenset(
    {
        "/api/auth/session/",
        "/api/notifications/updates/",
        "/api/notifications/unread-count/",
        "/api/messages/unread-count/",
        "/api/attendance/today/",
    }
)


class SlidingSessionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        user = getattr(request, "user", None)
        session = getattr(request, "session", None)
        if (
            session is not None
            and user is not None
            and user.is_authenticated
            and response.status_code < 400
            and not (request.method == "GET" and request.path in PASSIVE_PATHS)
        ):
            now = int(timezone.now().timestamp())
            if now - int(session.get(RENEWED_AT_KEY, 0)) >= settings.SESSION_RENEW_SECONDS:
                # Marks the session modified: SessionMiddleware (outer) saves it with a fresh
                # expiry (now + SESSION_COOKIE_AGE) and re-sends the cookie.
                session[RENEWED_AT_KEY] = now
        return response
