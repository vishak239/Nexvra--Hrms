"""Outgoing email. Delivery problems are logged (never with credentials, tokens or message
bodies) and never break the HR action that triggered the email."""

import logging
import smtplib

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction

logger = logging.getLogger("nexvra.email")


def _deliver(subject, body, recipients, purpose):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, recipients, fail_silently=False)
    except (smtplib.SMTPException, OSError) as exc:
        # Exception class + server message (e.g. "535 Authentication failed") are enough to
        # diagnose; the recipient address is logged so HR can resend, the body is not.
        logger.error(
            "Email delivery failed (purpose=%s, to=%s, backend=%s, host=%s:%s): %s: %s",
            purpose, ", ".join(recipients), settings.EMAIL_BACKEND, settings.EMAIL_HOST, settings.EMAIL_PORT,
            type(exc).__name__, exc,
        )
        return False
    logger.info("Email sent (purpose=%s, to=%s)", purpose, ", ".join(recipients))
    return True


def send_email(subject, body, recipients, *, purpose, now=False):
    """Send after the surrounding transaction commits (so a rolled-back action sends nothing).
    Returns the delivery result when sent immediately (`now=True` or no transaction)."""
    recipients = [r for r in recipients if r]
    if not recipients:
        return False
    if now or not transaction.get_connection().in_atomic_block:
        return _deliver(subject, body, recipients, purpose)
    transaction.on_commit(lambda: _deliver(subject, body, recipients, purpose))
    return None
