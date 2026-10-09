"""User-facing date/time text (notifications, error messages): 12-hour clock in the company
timezone (Asia/Kolkata by default). Stored timestamps stay timezone-aware; only text changes."""

from django.utils import timezone


def fmt_time(value, tz):
    """9:05 AM, 12:00 PM (noon), 12:30 AM (just after midnight)."""
    local = timezone.localtime(value, tz)
    hour = local.hour % 12 or 12
    return f"{hour}:{local:%M} {'AM' if local.hour < 12 else 'PM'}"


def fmt_day_time(value, tz):
    """05 Oct 2026, 2:30 PM"""
    return f"{timezone.localtime(value, tz):%d %b %Y}, {fmt_time(value, tz)}"
