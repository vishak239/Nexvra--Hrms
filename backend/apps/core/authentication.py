from rest_framework import authentication


class SessionAuthentication(authentication.SessionAuthentication):
    """Session auth that answers unauthenticated requests with 401 (not 403),
    so the frontend can tell "log in" apart from "not allowed"."""

    def authenticate_header(self, request):
        return "Session"
