"""Create a verified backup of the database and the private media files, then apply the
retention policy. Exit code 1 on any failure (so schedulers / monitoring see it), with the
reason in BACKUP_DIR/backup.log and an in-app alert to Super Admins."""

import logging
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.services import users_with_permission
from apps.core import backups
from apps.notifications.models import Notification
from apps.notifications.services import notify

logger = logging.getLogger("nexvra.backup")


def _log_line(text):
    path = Path(settings.BACKUP_DIR)
    path.mkdir(parents=True, exist_ok=True)
    with open(path / "backup.log", "a", encoding="utf-8") as fh:
        fh.write(f"{timezone.now().isoformat()} {text}\n")


class Command(BaseCommand):
    help = "Back up the PostgreSQL database and private media files (verified, with retention)."

    def add_arguments(self, parser):
        parser.add_argument("--retention-days", type=int, default=None,
                            help="Override BACKUP_RETENTION_DAYS for this run.")

    def handle(self, *args, **options):
        retention = options["retention_days"] or settings.BACKUP_RETENTION_DAYS
        try:
            manifest = backups.create_backup()
        except Exception as exc:  # report every failure the same way
            message = f"FAILED: {type(exc).__name__}: {exc}"
            _log_line(message)
            logger.error("Backup %s", message)
            notify(
                [u for u in users_with_permission("audit.view")],
                Notification.Type.GENERAL,
                "Backup failed",
                f"The scheduled backup did not complete: {exc}",
            )
            raise CommandError(message) from exc
        deleted = backups.prune(retention)
        size = sum(f["bytes"] for f in manifest["files"].values())
        message = (
            f"OK: {manifest['path']} ({size / 1024 / 1024:.1f} MB, {manifest['table_data_entries']} tables, "
            f"{manifest['media_files']} media files){'; copied to ' + manifest['copy'] if manifest.get('copy') else ''}"
            f"; removed {len(deleted)} set(s) older than {retention} days"
        )
        _log_line(message)
        logger.info("Backup %s", message)
        self.stdout.write(self.style.SUCCESS(message))
