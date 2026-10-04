"""Restore a backup set made by backup_hrms. Destructive: replaces the database contents
and the private media folder (the old media folder is kept beside it). Requires --yes.

Practice restores without touching live data:
    manage.py restore_hrms <set> --database nexvra_hrms_restore_test --skip-media --yes
"""

from django.core.management.base import BaseCommand, CommandError

from apps.core import backups


class Command(BaseCommand):
    help = "Restore the database and/or media files from a verified backup set."

    def add_arguments(self, parser):
        parser.add_argument("backup", help="Path to a nexvra-backup-... folder")
        parser.add_argument("--yes", action="store_true", help="Confirm that existing data will be replaced.")
        parser.add_argument("--database", default=None, help="Restore into this database instead (must exist).")
        parser.add_argument("--skip-database", action="store_true")
        parser.add_argument("--skip-media", action="store_true")
        parser.add_argument("--media-target", default=None, help="Extract media here instead of PRIVATE_MEDIA_ROOT.")

    def handle(self, *args, **opts):
        if not opts["yes"]:
            raise CommandError("Restoring replaces existing data. Stop the application, then re-run with --yes.")
        try:
            manifest = backups.verify_set(opts["backup"])
            self.stdout.write(f"Checksums OK (backup from {manifest['created_at']}).")
            if not opts["skip_database"]:
                name = backups.restore_database(opts["backup"], opts["database"])
                self.stdout.write(self.style.SUCCESS(f"Database restored into '{name}'."))
            if not opts["skip_media"]:
                target = backups.restore_media(opts["backup"], opts["media_target"])
                self.stdout.write(self.style.SUCCESS(f"Media restored into {target}."))
        except (backups.BackupError, OSError) as exc:
            raise CommandError(str(exc)) from exc
