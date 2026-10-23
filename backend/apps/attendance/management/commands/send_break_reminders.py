"""Send break-end SMS reminders.

Intended to be invoked by a periodic scheduler (e.g. Railway cron every 5 minutes, alongside
the existing reconcile job). For each active break it enqueues:

* reminder 1 at (break start + duration - SMS_BREAK_REMINDER_FIRST_MINUTES_BEFORE_END)
* reminder 2 at (break start + duration - SMS_BREAK_REMINDER_SECOND_MINUTES_BEFORE_END)

SMS delivery is idempotent (`SmsMessage.idempotency_key`), so retries, worker restarts and
redeployments never duplicate a message. When a break ends early, pending reminders are
cancelled (marked sent) so they never fire.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.notifications.sms import send_sms
from apps.organization.models import CompanySettings

from ...models import BreakSession


class Command(BaseCommand):
    help = "Queue break-end SMS reminders for active breaks approaching their configured end."

    def handle(self, *args, **options):
        cs = CompanySettings.get_solo()
        duration = cs.break_allowance_minutes or 60
        now = timezone.now()
        first_delta = timezone.timedelta(minutes=duration - 10)
        second_delta = timezone.timedelta(minutes=duration - 5)

        active = list(
            BreakSession.objects.select_related("employee__user")
            .filter(status=BreakSession.SessionStatus.ACTIVE, ended_at__isnull=True)
        )

        queued = 0
        cancelled = 0
        for break_session in active:
            employee = break_session.employee
            phone = (employee.phone or "").strip()
            name = employee.full_name
            started = break_session.started_at
            if started is None:
                continue

            first_due = started + first_delta
            second_due = started + second_delta

            # Reminder 1: 10 minutes before the end.
            if not break_session.reminder_1_sent and now >= first_due and phone:
                if _send(break_session, employee, phone, name, 10, "BREAK_REMINDER"):
                    break_session.reminder_1_sent = True
                    queued += 1

            # Reminder 2: 5 minutes before the end.
            if not break_session.reminder_2_sent and now >= second_due and phone:
                if _send(break_session, employee, phone, name, 5, "BREAK_REMINDER"):
                    break_session.reminder_2_sent = True
                    queued += 1

            # Break ended early (or already ended): cancel any unsent reminders.
            if break_session.ended_at is not None:
                if not break_session.reminder_1_sent:
                    break_session.reminder_1_sent = True
                    cancelled += 1
                if not break_session.reminder_2_sent:
                    break_session.reminder_2_sent = True
                    cancelled += 1

            if break_session.reminder_1_sent or break_session.reminder_2_sent or break_session.ended_at is not None:
                break_session.save(
                    update_fields=[
                        "reminder_1_sent",
                        "reminder_2_sent",
                        "reminder_duration_minutes",
                        "updated_at",
                    ]
                )
                break_session.reminder_duration_minutes = duration

        self.stdout.write(
            f"Processed {len(active)} active break(s): {queued} reminder(s) queued, {cancelled} cancelled."
        )


def _send(break_session, employee, phone, name, minutes_remaining, purpose):
    """Enqueue one reminder SMS idempotently. Returns True when a row was created."""
    from apps.notifications.models import SmsMessage

    key = f"sms:{purpose}|{break_session.pk}|{phone}"
    if SmsMessage.objects.filter(idempotency_key=key).exists():
        return False
    body = (
        f"Hi {name}, only {minutes_remaining} minutes remain in your break. "
        f"Please return to work on time."
    )
    send_sms(
        phone=phone,
        body=body,
        purpose=purpose,
        reference=str(break_session.pk),
        scheduled_at=timezone.now(),
    )
    return True
