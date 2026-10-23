"""Outbound SMS with a swappable provider and persistent idempotent records.

Design goals
------------
* Never log message bodies or credentials.
* Every intended delivery is one persistent `SmsMessage` row with an idempotency key, so
  retries, worker restarts and redeployments never duplicate a message.
* Providers are pluggable: Twilio in production when credentials are configured, otherwise a
  console/no-op provider so the code path is exercised and tested locally without real SMS.
* Delivery failures are recorded, not raised: SMS never blocks an HR action (login,
  check-in, break end ...).
"""

from __future__ import annotations

import hashlib
import logging
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import SmsMessage

logger = logging.getLogger("nexvra.sms")

# A delivery is retried up to this many times before being left FAILED for manual review.
MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class SmsResult:
    """Outcome of attempting one SMS delivery."""

    sent: bool
    message_id: str | None
    error: str | None


class SmsProvider(ABC):
    """Abstract SMS provider. Implement `send` to talk to a real gateway."""

    @abstractmethod
    def send(self, to: str, body: str) -> SmsResult:
        """Send one SMS. Return success/failure; never raise."""


class ConsoleSmsProvider(SmsProvider):
    """Development provider: records the send in logs without contacting any gateway.

    Message content itself is never logged; only the fact that a message would be sent.
    """

    def send(self, to: str, body: str) -> SmsResult:
        masked = to[-4:] if to else ""
        logger.info("SMS would be sent (console provider) to %s*** len=%d", masked, len(body or ""))
        digest = hashlib.sha256((to + body).encode()).hexdigest()[:16]
        return SmsResult(sent=True, message_id="console-" + digest, error=None)


class TwilioSmsProvider(SmsProvider):
    """Twilio REST provider. Uses stdlib urllib only so no extra runtime dependency is required."""

    def __init__(self, account_sid: str, auth_token: str, from_: str):
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.from_ = from_

    def _auth_header(self) -> str:
        import base64

        token = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        return f"Basic {token}"

    def send(self, to: str, body: str) -> SmsResult:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        data = urllib.parse.urlencode({"To": to, "From": self.from_, "Body": body}).encode()
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Authorization", self._auth_header())
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                import json

                payload = json.loads(resp.read().decode() or "{}")
                return SmsResult(
                    sent=True,
                    message_id=str(payload.get("sid") or ""),
                    error=None,
                )
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode()[:500]
            return SmsResult(sent=False, message_id=None, error=f"HTTP {exc.code}: {body_text}")
        except (urllib.error.URLError, OSError) as exc:
            return SmsResult(sent=False, message_id=None, error=f"{type(exc).__name__}: {exc}")


def _provider() -> SmsProvider:
    """Build the configured provider. Falls back to ConsoleSmsProvider when no credentials."""
    account_sid = getattr(settings, "SMS_TWILIO_ACCOUNT_SID", "") or ""
    auth_token = getattr(settings, "SMS_TWILIO_AUTH_TOKEN", "") or ""
    from_ = getattr(settings, "SMS_TWILIO_FROM", "") or ""
    if account_sid and auth_token and from_:
        return TwilioSmsProvider(account_sid, auth_token, from_)
    return ConsoleSmsProvider()


def _idempotency_key(purpose: str, reference: str, phone: str) -> str:
    import hashlib as _h

    return "sms:" + _h.sha256(f"{purpose}|{reference}|{phone}".encode()).hexdigest()


def send_sms(
    *,
    phone: str,
    body: str,
    purpose: str,
    reference: str = "",
    scheduled_at=None,
) -> SmsMessage | None:
    """Enqueue (and attempt) one idempotent SMS.

    Returns the `SmsMessage` row, or None when no phone/body is provided. The provider is
    invoked at most once per `(purpose, reference, phone)` tuple. Delivery failure is
    recorded and does not raise.
    """
    phone = (phone or "").strip()
    body = (body or "").strip()
    if not phone or not body:
        return None
    key = _idempotency_key(purpose, reference, phone)
    with transaction.atomic():
        row = (
            SmsMessage.objects.select_for_update()
            .filter(idempotency_key=key)
            .first()
        )
        if row is not None:
            # Already queued/sent/failed for this logical message: do not retry a terminal row.
            if row.status in (SmsMessage.Status.SENT, SmsMessage.Status.FAILED, SmsMessage.Status.UNDELIVERED):
                return row
            row.attempts += 1
            row.save(update_fields=["attempts", "updated_at"])
        else:
            row = SmsMessage.objects.create(
                phone=phone,
                body=body,
                purpose=purpose,
                reference=reference,
                idempotency_key=key,
                status=SmsMessage.Status.QUEUED,
                scheduled_at=scheduled_at or timezone.now(),
            )
    result = _provider().send(phone, body)
    now = timezone.now()
    with transaction.atomic():
        row = SmsMessage.objects.select_for_update().get(pk=row.pk)
        row.attempts += 1
        if result.sent:
            row.status = SmsMessage.Status.SENT
            row.provider_message_id = result.message_id or ""
            row.sent_at = now
            row.provider_error = ""
        elif row.attempts >= MAX_ATTEMPTS:
            row.status = SmsMessage.Status.FAILED
            row.provider_error = result.error or ""
        else:
            row.status = SmsMessage.Status.QUEUED
            row.provider_error = result.error or ""
        row.save(update_fields=["attempts", "status", "provider_message_id", "provider_error", "sent_at", "updated_at"])
    if not result.sent:
        logger.warning("SMS delivery failed (purpose=%s, attempts=%d): %s", purpose, row.attempts, result.error)
    return row


def send_due_sms() -> int:
    """Attempt all queued SMS whose scheduled_at has passed and attempts < MAX_ATTEMPTS.

    Returns the number of rows touched. Intended to be invoked by a periodic scheduler
    (Railway cron). Each row is processed once per call; provider failures leave it QUEUED
    for the next run.
    """
    now = timezone.now()
    due = (
        SmsMessage.objects.filter(status=SmsMessage.Status.QUEUED, scheduled_at__lte=now)
        .order_by("scheduled_at", "id")
    )
    touched = 0
    for row in due:
        if row.attempts >= MAX_ATTEMPTS:
            continue
        result = _provider().send(row.phone, row.body)
        touched += 1
        now2 = timezone.now()
        with transaction.atomic():
            row = SmsMessage.objects.select_for_update().get(pk=row.pk)
            row.attempts += 1
            if result.sent:
                row.status = SmsMessage.Status.SENT
                row.provider_message_id = result.message_id or ""
                row.sent_at = now2
                row.provider_error = ""
            elif row.attempts >= MAX_ATTEMPTS:
                row.status = SmsMessage.Status.FAILED
                row.provider_error = result.error or ""
            else:
                row.status = SmsMessage.Status.QUEUED
                row.provider_error = result.error or ""
            fields = ["attempts", "status", "provider_message_id", "provider_error", "sent_at", "updated_at"]
            row.save(update_fields=fields)
    return touched
