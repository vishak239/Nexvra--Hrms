"""Backups (verification, retention, restore safety) and the production settings guards."""

import datetime
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path
from unittest import mock

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core import backups

UTC = datetime.UTC
BACKEND = Path(__file__).resolve().parents[3]


@pytest.fixture
def backup_env(settings, tmp_path):
    settings.BACKUP_DIR = tmp_path / "backups"
    settings.BACKUP_COPY_DIR = ""
    settings.PRIVATE_MEDIA_ROOT = tmp_path / "media"
    (tmp_path / "media" / "documents").mkdir(parents=True)
    (tmp_path / "media" / "documents" / "a.pdf").write_bytes(b"%PDF-1.4 test")
    (tmp_path / "media" / "photo.png").write_bytes(b"\x89PNG test")
    return tmp_path


def _fake_set(base, stamp):
    folder = base / f"{backups.PREFIX}{stamp:%Y%m%d-%H%M%SZ}"
    folder.mkdir(parents=True)
    (folder / "manifest.json").write_text("{}", encoding="utf-8")
    return folder


def test_retention_deletes_only_old_backup_sets(backup_env, settings):
    now = datetime.datetime(2026, 10, 3, 2, 0, tzinfo=UTC)
    old = _fake_set(settings.BACKUP_DIR, now - datetime.timedelta(days=15))
    recent = _fake_set(settings.BACKUP_DIR, now - datetime.timedelta(days=3))
    unrelated = settings.BACKUP_DIR / "keep-me"
    unrelated.mkdir()
    deleted = backups.prune(14, now=now)
    assert deleted == [old.name]
    assert recent.exists() and unrelated.exists() and not old.exists()


def test_zip_verification_and_unsafe_archives(backup_env, tmp_path):
    good = tmp_path / "good.zip"
    with zipfile.ZipFile(good, "w") as zf:
        zf.writestr("documents/a.pdf", "x")
    assert backups.verify_zip(good, 1) == 1
    with pytest.raises(backups.BackupError, match="expected 2"):
        backups.verify_zip(good, 2)
    evil_set = tmp_path / "evil"
    evil_set.mkdir()
    with zipfile.ZipFile(evil_set / "media.zip", "w") as zf:
        zf.writestr("../../outside.txt", "x")
    with pytest.raises(backups.BackupError, match="Unsafe path"):
        backups.restore_media(evil_set, target=tmp_path / "restored")
    assert not (tmp_path / "outside.txt").exists()


def test_restore_refuses_damaged_or_incomplete_sets(backup_env, tmp_path):
    incomplete = tmp_path / "incomplete"
    incomplete.mkdir()
    with pytest.raises(backups.BackupError, match="no manifest"):
        backups.verify_set(incomplete)
    damaged = tmp_path / "damaged"
    damaged.mkdir()
    (damaged / "database.dump").write_bytes(b"changed")
    manifest = {"created_at": "x", "files": {"database.dump": {"bytes": 7, "sha256": "0" * 64}}}
    (damaged / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(backups.BackupError, match="checksum"):
        backups.verify_set(damaged)
    with pytest.raises(CommandError, match="--yes"):
        call_command("restore_hrms", str(damaged))


def test_failed_backup_is_reported_and_leaves_nothing_behind(backup_env, settings, org):
    with mock.patch("apps.core.backups._run", side_effect=backups.BackupError("pg_dump failed (exit 1): no access")):
        with pytest.raises(CommandError, match="FAILED"):
            call_command("backup_hrms", stdout=mock.Mock())
    log = (settings.BACKUP_DIR / "backup.log").read_text(encoding="utf-8")
    assert "FAILED" in log and "no access" in log
    assert not list(settings.BACKUP_DIR.glob(f"{backups.PREFIX}*"))
    from apps.notifications.models import Notification

    assert Notification.objects.filter(recipient=org["super_admin"].user, title="Backup failed").exists()


def _pg_tools_available():
    try:
        backups.pg_tool("pg_dump")
        backups.pg_tool("pg_restore")
        return True
    except backups.BackupError:
        return False


@pytest.mark.skipif(not _pg_tools_available(), reason="PostgreSQL client tools not installed")
def test_real_backup_is_verified_and_restorable_in_place(backup_env, settings, org):
    call_command("backup_hrms", stdout=mock.Mock())
    sets = list(settings.BACKUP_DIR.glob(f"{backups.PREFIX}*"))
    assert len(sets) == 1
    manifest = backups.verify_set(sets[0])
    assert manifest["verified"] is True and manifest["media_files"] == 2
    assert manifest["table_data_entries"] > 10
    restored = backups.restore_media(sets[0], target=backup_env / "restored")
    assert (Path(restored) / "documents" / "a.pdf").read_bytes() == b"%PDF-1.4 test"
    assert "OK:" in (settings.BACKUP_DIR / "backup.log").read_text(encoding="utf-8")


# --- production settings guards ----------------------------------------------------------


def _settings_import(**env):
    clean = {k: v for k, v in os.environ.items() if not k.startswith("DJANGO_")}
    clean.update(env)
    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", "import config.settings"], cwd=BACKEND, env=clean, capture_output=True, text=True
    )


@pytest.mark.parametrize(
    "env, message",
    [
        ({"DJANGO_ENV": "production", "DJANGO_DEBUG": "True"}, "DJANGO_DEBUG must be False"),
        ({"DJANGO_ENV": "production", "DJANGO_DEBUG": "False", "DJANGO_SECRET_KEY": "short"}, "strong, unique"),
        ({"DJANGO_ENV": "staging", "DJANGO_DEBUG": "False", "DJANGO_SECRET_KEY": "k" * 60,
          "DJANGO_ALLOWED_HOSTS": "*"}, "'*' is not allowed"),
        ({"DJANGO_ENV": "qa"}, "development, staging or production"),
    ],
)
def test_deployed_environments_refuse_unsafe_settings(env, message):
    result = _settings_import(**env)
    assert result.returncode != 0
    assert message in result.stderr


def test_production_settings_are_secure():
    code = (
        "import config.settings as s;"
        "print(s.DEBUG, s.SESSION_COOKIE_SECURE, s.CSRF_COOKIE_SECURE, s.SECURE_SSL_REDIRECT,"
        " s.SECURE_HSTS_SECONDS > 0, s.SECURE_PROXY_SSL_HEADER)"
    )
    clean = {k: v for k, v in os.environ.items() if not k.startswith("DJANGO_")}
    clean.update(DJANGO_ENV="production", DJANGO_DEBUG="False", DJANGO_SECRET_KEY="x" * 64,
                 DJANGO_ALLOWED_HOSTS="hrms.example.test")
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code], cwd=BACKEND, env=clean, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "False True True True True ('HTTP_X_FORWARDED_PROTO', 'https')"
