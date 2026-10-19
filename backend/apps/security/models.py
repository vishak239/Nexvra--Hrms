"""Explainable, configurable suspicious-login detection.

Every signal is evidence for human review, never proof of identity and never an automatic
accusation. Shared office networks, mobile networks, VPNs and browser updates can all trigger
signals, so events are always reviewable and never mark anyone absent.
"""

from django.conf import settings
from django.db import models


class SecurityEvent(models.Model):
    class Kind(models.TextChoices):
        NEW_DEVICE = "NEW_DEVICE", "Login from a new device"
        NEW_IP = "NEW_IP", "Login from a new IP address"
        RAPID_IP_CHANGE = "RAPID_IP_CHANGE", "Rapid IP address change"
        REPEATED_LOGIN_FAILURES = "REPEATED_LOGIN_FAILURES", "Repeated login failures"
        CONCURRENT_SESSIONS = "CONCURRENT_SESSIONS", "Concurrent sessions from different devices"
        CONFLICTING_ATTENDANCE = "CONFLICTING_ATTENDANCE", "Conflicting attendance sessions"

    class RiskLevel(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"

    class ReviewStatus(models.TextChoices):
        OPEN = "OPEN", "Open"
        REVIEWED = "REVIEWED", "Reviewed"
        DISMISSED = "DISMISSED", "Dismissed"
        ESCALATED = "ESCALATED", "Escalated"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="security_events"
    )
    employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.CASCADE, related_name="security_events"
    )
    kind = models.CharField(max_length=32, choices=Kind.choices)
    risk_level = models.CharField(max_length=10, choices=RiskLevel.choices)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_security_events",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=500, blank=True)
    review_status = models.CharField(max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.OPEN)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["employee", "-created_at"]),
            models.Index(fields=["risk_level", "-created_at"]),
            models.Index(fields=["review_status", "-created_at"]),
            models.Index(fields=["ip_address", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.user_id or 'unknown'} {self.kind} {self.risk_level}"
