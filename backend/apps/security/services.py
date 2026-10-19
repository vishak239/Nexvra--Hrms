"""Suspicious-login detection.

Signals are explainable and configurable. None of them automatically marks an employee absent or
accuses them of fraud; they are reviewable evidence for HR / admin.
"""

import datetime

from django.utils import timezone

from apps.audit import services as audit
from apps.audit.models import AuditLog
from apps.employees.models import Employee

from .models import SecurityEvent

# A failed-login surge is only a signal when this many failures arrive from one IP in the window.
FAILURE_THRESHOLD = 5
FAILURE_WINDOW = datetime.timedelta(minutes=15)
# Two successful logins from different IPs within this window count as a rapid change.
RAPID_WINDOW = datetime.timedelta(hours=1)
# Don't re-alert the same open event within this window.
DEDUP_WINDOW = datetime.timedelta(minutes=30)


def _risk(kind):
    if kind == SecurityEvent.Kind.RAPID_IP_CHANGE:
        return SecurityEvent.RiskLevel.HIGH
    return SecurityEvent.RiskLevel.MEDIUM


def _create_event(user, employee, kind, ip_address, user_agent, now, metadata=None):
    """Create an event unless an identical OPEN one was already raised recently (dedup)."""
    since = now - DEDUP_WINDOW
    lookup = {"kind": kind, "review_status": SecurityEvent.ReviewStatus.OPEN, "created_at__gte": since}
    if user is not None:
        lookup["user"] = user
    elif ip_address is not None:
        lookup["ip_address"] = ip_address
    else:
        lookup["user__isnull"] = True
    if SecurityEvent.objects.filter(**lookup).exists():
        return None
    return SecurityEvent.objects.create(
        user=user,
        employee=employee,
        kind=kind,
        risk_level=_risk(kind),
        ip_address=ip_address,
        user_agent=user_agent or "",
        metadata=metadata or {},
    )


def detect_login(request, user, outcome, ip_address, user_agent, now=None):
    """Run explainable signals after a login attempt. Returns newly created SecurityEvents.

    Intended to be called by LoginView before the LOGIN/LOGIN_FAILED audit record is written,
    so the current attempt is not compared against itself. `now` overrides the clock (tests).
    """
    now = now or timezone.now()
    employee = Employee.objects.filter(user=user).first() if user and user.is_authenticated else None
    created = []

    if outcome == "success":
        prior_logins = AuditLog.objects.filter(actor=user, action="LOGIN")
        is_first_login = not prior_logins.exists()

        # New device: the user has logged in before, but never with this user agent.
        # A first-ever login is not flagged; only a change from the known device is.
        if user_agent and prior_logins.exists() and not prior_logins.filter(user_agent=user_agent).exists():
            ev = _create_event(
                user, employee, SecurityEvent.Kind.NEW_DEVICE, ip_address, user_agent, now,
                metadata={"first_login": is_first_login},
            )
            if ev is not None:
                created.append(ev)

        # New IP address for this user: only meaningful once the user has a known IP to compare against.
        if ip_address and prior_logins.exists() and not prior_logins.filter(ip_address=ip_address).exists():
            ev = _create_event(
                user, employee, SecurityEvent.Kind.NEW_IP, ip_address, user_agent, now,
                metadata={"first_login": is_first_login, "first_login_from_ip": not prior_logins.exists()},
            )
            if ev is not None:
                created.append(ev)

        # Rapid IP change: a prior successful login from a different IP within the window.
        if ip_address:
            recent = (
                prior_logins.filter(created_at__gte=now - RAPID_WINDOW, ip_address__isnull=False)
                .exclude(ip_address=ip_address)
                .order_by("-created_at")
                .first()
            )
            if recent is not None:
                ev = _create_event(
                    user, employee, SecurityEvent.Kind.RAPID_IP_CHANGE, ip_address, user_agent, now,
                    metadata={"prior_ip": recent.ip_address},
                )
                if ev is not None:
                    created.append(ev)

    else:  # failed
        failures = AuditLog.objects.filter(action="LOGIN_FAILED", created_at__gte=now - FAILURE_WINDOW)
        if ip_address:
            ip_failures = failures.filter(ip_address=ip_address)
            if ip_failures.count() >= FAILURE_THRESHOLD:
                ev = _create_event(
                    None,
                    None,
                    SecurityEvent.Kind.REPEATED_LOGIN_FAILURES,
                    ip_address,
                    user_agent,
                    now,
                    metadata={
                        "failures": ip_failures.count(),
                        "window_minutes": int(FAILURE_WINDOW.total_seconds() // 60),
                    },
                )
                if ev is not None:
                    created.append(ev)

    return created


def review_event(event, actor, review_status, resolution_note=""):
    """Record a human review decision on a security event and audit it."""

    if event.review_status != SecurityEvent.ReviewStatus.OPEN:
        from apps.core.exceptions import Conflict
        raise Conflict("This security event has already been reviewed.")
    event.review_status = review_status
    event.reviewed_by = actor
    event.reviewed_at = timezone.now()
    event.resolution_note = resolution_note
    event.save(
        update_fields=["review_status", "reviewed_by", "reviewed_at", "resolution_note"]
    )
    audit.record(
        None,
        "SECURITY_EVENT_REVIEWED",
        obj=event,
        actor=actor,
        metadata={
            "kind": event.kind,
            "risk_level": event.risk_level,
            "review_status": review_status,
            "resolution_note": resolution_note,
        },
    )
    return event
