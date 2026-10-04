"""SMTP diagnostics: send one test message and report the result (never prints credentials)."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.core.mail import send_email


class Command(BaseCommand):
    help = "Send a test email to check the SMTP settings (EMAIL_* environment variables)."

    def add_arguments(self, parser):
        parser.add_argument("--to", required=True, help="Recipient address")

    def handle(self, *args, **options):
        self.stdout.write(
            f"Backend: {settings.EMAIL_BACKEND}\nHost: {settings.EMAIL_HOST or '(not set)'}:{settings.EMAIL_PORT} "
            f"TLS={settings.EMAIL_USE_TLS} SSL={getattr(settings, 'EMAIL_USE_SSL', False)}\n"
            f"User: {'(set)' if settings.EMAIL_HOST_USER else '(not set)'}  "
            f"Password: {'(set)' if settings.EMAIL_HOST_PASSWORD else '(not set)'}\n"
            f"From: {settings.DEFAULT_FROM_EMAIL}"
        )
        ok = send_email(
            "Nexvra HRMS test email",
            "This is a test message from Nexvra HRMS. If you received it, email delivery works.",
            [options["to"]],
            purpose="smtp_test",
            now=True,
        )
        if not ok:
            raise CommandError("Sending failed. See the 'nexvra.email' log line above for the server's reason.")
        self.stdout.write(self.style.SUCCESS(f"Sent to {options['to']}."))
