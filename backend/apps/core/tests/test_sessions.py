"""Session lifetime follows real use (root cause of the "checked out at 6 PM" bug), India Standard
Time for business days, and 12-hour times in user-facing text."""

import datetime
import zoneinfo
from unittest import mock

import pytest
from django.contrib.sessions.models import Session
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.attendance.models import AttendanceRecord, BreakSession
from apps.core.timefmt import fmt_day_time, fmt_time
from apps.notifications.models import Notification
from conftest import PASSWORD

pytestmark = pytest.mark.django_db

IST = zoneinfo.ZoneInfo("Asia/Kolkata")


def ist(day, hour, minute=0):
    return datetime.datetime(2026, 10, day, hour, minute, tzinfo=IST)


def freeze(moment):
    return mock.patch("django.utils.timezone.now", return_value=moment)


@pytest.fixture
def real_session_age(settings):
    """Production values (the suite otherwise uses a very long session)."""
    settings.SESSION_COOKIE_AGE = 8 * 60 * 60
    settings.SESSION_RENEW_SECONDS = 5 * 60
    settings.TIME_ZONE = "Asia/Kolkata"


def sign_in(user, moment):
    client = APIClient()
    with freeze(moment):
        client.get("/api/auth/csrf/")
        res = client.post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json")
    assert res.status_code == 200, res.data
    return client


def call(client, method, path, moment, data=None):
    with freeze(moment):
        return getattr(client, method)(path, data or {}, format="json")


def session_expiry(client):
    key = client.cookies["nexvra_session"].value
    return Session.objects.get(session_key=key).expire_date


def test_an_employee_working_past_6_pm_stays_signed_in_and_checked_in(org, real_session_age):
    """09:00 sign-in and check-in, working all day: nothing ends the session or the attendance at
    17:00 (sign-in + 8 h) or at 18:00. Before the fix the session expired at 17:00, the browser
    stopped reporting activity and the inactivity rule checked the employee out."""
    alice = sign_in(org["alice"].user, ist(6, 9))
    assert call(alice, "post", "/api/attendance/check-in/", ist(6, 9, 1)).status_code == 201
    moment = ist(6, 9, 1)
    while moment < ist(6, 19, 30):  # a heartbeat every 10 minutes with fresh activity
        moment += datetime.timedelta(minutes=10)
        cache.clear()  # the heartbeat throttle counts real seconds; this loop spans hours of frozen time
        res = call(alice, "post", "/api/attendance/heartbeat/", moment,
                   {"idle_seconds": 5, "activity": [300, 5], "observed_seconds": 600})
        assert res.status_code == 200, f"signed out at {moment:%H:%M}"
        assert res.data["state"]["record"]["check_out"] is None, f"checked out at {moment:%H:%M}"
    assert session_expiry(alice) > ist(6, 19, 30) + datetime.timedelta(hours=7)
    res = call(alice, "post", "/api/attendance/check-out/", ist(6, 19, 45))
    assert res.status_code == 200 and res.data["checkout_reason"] == "MANUAL"
    rec = AttendanceRecord.objects.get(employee=org["alice"])
    assert rec.date == datetime.date(2026, 10, 6) and rec.worked_minutes == 10 * 60 + 44


def test_session_renewal_is_throttled_and_background_polls_do_not_count(org, real_session_age):
    alice = sign_in(org["alice"].user, ist(6, 9))
    first = session_expiry(alice)
    call(alice, "get", "/api/auth/me/", ist(6, 9, 2))  # within 5 minutes: no write
    assert session_expiry(alice) == first
    call(alice, "get", "/api/notifications/updates/", ist(6, 12))  # background poll: not use
    call(alice, "get", "/api/attendance/today/", ist(6, 12))
    assert session_expiry(alice) == first
    call(alice, "get", "/api/auth/me/", ist(6, 12))  # real use renews the 8 idle hours
    assert session_expiry(alice) == ist(6, 20)


def test_an_unattended_browser_still_signs_out_after_8_idle_hours(org, real_session_age):
    alice = sign_in(org["alice"].user, ist(6, 9))
    for hour in range(10, 17):  # only background polling for 8 hours
        call(alice, "get", "/api/notifications/updates/", ist(6, hour))
    assert call(alice, "get", "/api/auth/me/", ist(6, 17, 1)).status_code in (401, 403)


def test_valid_automatic_check_outs_still_apply(org, client_for, real_session_age):
    alice = sign_in(org["alice"].user, ist(6, 9))
    call(alice, "post", "/api/attendance/check-in/", ist(6, 9, 1))
    active = {"idle_seconds": 0, "activity": [0], "observed_seconds": 60}
    idle = {"idle_seconds": 1860, "activity": [], "observed_seconds": 1900}
    call(alice, "post", "/api/attendance/heartbeat/", ist(6, 9, 10), active)
    res = call(alice, "post", "/api/attendance/heartbeat/", ist(6, 9, 41), idle)
    rec = AttendanceRecord.objects.get(employee=org["alice"])
    assert res.data["changed"] is True and rec.checkout_reason == "INACTIVITY_TIMEOUT"
    assert rec.check_out == ist(6, 9, 40)  # 30 minutes after the last activity, not a fixed time


# --- India Standard Time -------------------------------------------------------------------


def test_attendance_day_follows_the_indian_calendar(org, real_session_age):
    """00:30 IST on 7 Oct is still 6 Oct in UTC: the record belongs to 7 Oct."""
    alice = sign_in(org["alice"].user, ist(7, 0, 20))
    assert call(alice, "post", "/api/attendance/check-in/", ist(7, 0, 30)).status_code == 201
    rec = AttendanceRecord.objects.get(employee=org["alice"])
    assert rec.date == datetime.date(2026, 10, 7)
    today = call(alice, "get", "/api/attendance/today/", ist(7, 0, 31)).data
    assert str(today["date"]) == "2026-10-07"
    assert today["record"]["check_in"].endswith("+05:30")  # API times carry the IST offset


def test_break_allowance_resets_at_indian_midnight(org, configure, real_session_age):
    configure(inactivity_timeout_minutes=None)
    alice = sign_in(org["alice"].user, ist(6, 22))
    call(alice, "post", "/api/attendance/check-in/", ist(6, 22))
    call(alice, "post", "/api/attendance/breaks/start/", ist(6, 22, 30))
    call(alice, "post", "/api/attendance/breaks/end/", ist(6, 23, 30))  # the whole 60 minutes
    blocked = call(alice, "post", "/api/attendance/breaks/start/", ist(6, 23, 40))
    assert blocked.status_code == 409 and blocked.data["error"]["code"] == "break_allowance_used"
    call(alice, "post", "/api/attendance/check-out/", ist(6, 23, 50))
    # 00:10 IST is a new Indian day (still 6 Oct in UTC): a new record with a fresh allowance.
    assert call(alice, "post", "/api/attendance/check-in/", ist(7, 0, 10)).status_code == 201
    res = call(alice, "post", "/api/attendance/breaks/start/", ist(7, 0, 20))
    assert res.status_code == 200 and res.data["state"]["break_used_seconds"] == 0
    assert sorted(AttendanceRecord.objects.values_list("date", flat=True)) == [
        datetime.date(2026, 10, 6), datetime.date(2026, 10, 7)]


def test_break_auto_end_sends_a_break_notice(org, configure, real_session_age):
    configure(inactivity_timeout_minutes=None)
    alice = sign_in(org["alice"].user, ist(6, 9))
    call(alice, "post", "/api/attendance/check-in/", ist(6, 9))
    call(alice, "post", "/api/attendance/breaks/start/", ist(6, 13))
    call(alice, "get", "/api/attendance/today/", ist(6, 14, 20))  # the allowance closed it at 14:00
    assert BreakSession.objects.get(employee=org["alice"]).end_reason == "ALLOWANCE_EXHAUSTED"
    note = Notification.objects.get(recipient=org["alice"].user, type="BREAK_AUTO_ENDED")
    assert "2:00 PM" in note.message


# --- 12-hour text ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        (ist(6, 0, 0), "12:00 AM"),
        (ist(6, 0, 5), "12:05 AM"),
        (ist(6, 9, 0), "9:00 AM"),
        (ist(6, 12, 0), "12:00 PM"),
        (ist(6, 13, 30), "1:30 PM"),
        (ist(6, 18, 0), "6:00 PM"),
        (ist(6, 23, 59), "11:59 PM"),
        (datetime.datetime(2026, 10, 6, 12, 30, tzinfo=datetime.UTC), "6:00 PM"),  # UTC input shown in IST
    ],
)
def test_twelve_hour_format_in_ist(moment, expected):
    assert fmt_time(moment, IST) == expected


def test_day_and_time_text():
    assert fmt_day_time(ist(5, 14, 30), IST) == "05 Oct 2026, 2:30 PM"


def test_inactivity_notice_uses_twelve_hour_ist(org, real_session_age):
    alice = sign_in(org["alice"].user, ist(6, 17))
    call(alice, "post", "/api/attendance/check-in/", ist(6, 17, 30))
    idle = {"idle_seconds": 1860, "activity": [], "observed_seconds": 1900}
    call(alice, "post", "/api/attendance/heartbeat/", ist(6, 18, 1), idle)
    note = Notification.objects.get(recipient=org["alice"].user, type="ATTENDANCE_AUTO_CHECKOUT")
    assert "Checked out at 6:00 PM" in note.message and "18:00" not in note.message
