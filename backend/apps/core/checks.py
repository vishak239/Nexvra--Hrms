"""Deployment checks (`manage.py check --deploy`) for Nexvra-specific settings."""

from django.conf import settings
from django.core.checks import Tags, Warning, register


@register(Tags.security, deploy=True)
def nexvra_deploy_checks(app_configs, **kwargs):
    issues = []
    if "console" in settings.EMAIL_BACKEND or "locmem" in settings.EMAIL_BACKEND:
        issues.append(
            Warning(
                "Emails are not delivered (EMAIL_BACKEND is the console/locmem backend).",
                hint="Set EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend and the EMAIL_* variables.",
                id="nexvra.W001",
            )
        )
    backup = settings.BACKUP_DIR.resolve()
    for public in (settings.STATIC_ROOT, settings.PRIVATE_MEDIA_ROOT):
        public = public.resolve()
        if backup == public or public in backup.parents:
            issues.append(
                Warning(
                    f"BACKUP_DIR ({backup}) is inside {public}.",
                    hint="Keep backups outside static/media directories.",
                    id="nexvra.W002",
                )
            )
    if not settings.FRONTEND_URL.startswith("https://"):
        issues.append(
            Warning(
                "FRONTEND_URL is not https:// - links in password-reset and account emails will be insecure.",
                hint="Set FRONTEND_URL=https://<your-domain>.",
                id="nexvra.W003",
            )
        )
    return issues
