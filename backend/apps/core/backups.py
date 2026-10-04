"""Verified backups of the PostgreSQL database and the private media files.

A backup set is one folder in settings.BACKUP_DIR:

    nexvra-backup-20261003-021500Z/
        database.dump      pg_dump custom format (compressed; restore with pg_restore)
        media.zip          every file under PRIVATE_MEDIA_ROOT
        manifest.json      sizes, SHA-256 checksums and verification results

A set only counts as successful after it was verified: the dump is non-empty and pg_restore
can read its table of contents (including real table data), and the zip passes an integrity
test with the expected number of files. Credentials are passed to pg_dump through the
environment (PGPASSWORD), never on the command line or in logs.
"""

import datetime
import hashlib
import json
import os
import shutil
import subprocess  # nosec B404 - runs only pg_dump/pg_restore with fixed arguments
import zipfile
from pathlib import Path

from django.conf import settings
from django.utils import timezone

PREFIX = "nexvra-backup-"
KNOWN_TABLE = "attendance_attendancerecord"


class BackupError(Exception):
    pass


def pg_tool(name):
    candidates = []
    if settings.PG_BIN_DIR:
        candidates.append(Path(settings.PG_BIN_DIR) / name)
        candidates.append(Path(settings.PG_BIN_DIR) / f"{name}.exe")
    found = shutil.which(name)
    if found:
        candidates.append(Path(found))
    for version in ("17", "16", "15"):
        candidates.append(Path(rf"C:\Program Files\PostgreSQL\{version}\bin\{name}.exe"))
    for path in candidates:
        if path.is_file():
            return str(path)
    raise BackupError(f"{name} was not found. Install the PostgreSQL client tools or set PG_BIN_DIR.")


def _db(database=None):
    db = settings.DATABASES["default"]
    env = {**os.environ, "PGPASSWORD": db.get("PASSWORD") or ""}
    args = ["-h", db.get("HOST") or "localhost", "-p", str(db.get("PORT") or 5432), "-U", db.get("USER") or ""]
    return args, env, database or db["NAME"]


def _run(cmd, env, what):
    # nosec B603: argument list (no shell); the executable is a located pg tool and every argument comes
    # from settings or a backup path chosen by the operator, never from HTTP input.
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60 * 60)  # noqa: S603  # nosec B603
    if result.returncode != 0:
        # pg tools print connection/permission problems to stderr; it never contains the password.
        raise BackupError(f"{what} failed (exit {result.returncode}): {result.stderr.strip()[:500]}")
    return result.stdout


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_dump(path):
    if not path.is_file() or path.stat().st_size == 0:
        raise BackupError("The database dump is missing or empty.")
    args, env, _ = _db()
    listing = _run([pg_tool("pg_restore"), "--list", str(path)], env, "Reading the dump")
    data_entries = sum(1 for line in listing.splitlines() if " TABLE DATA " in line)
    if data_entries == 0 or KNOWN_TABLE not in listing:
        raise BackupError("The dump does not contain the expected HRMS tables.")
    return data_entries


def _media_files(root):
    root = Path(root)
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def verify_zip(path, expected):
    if not path.is_file() or path.stat().st_size == 0:
        raise BackupError("The media archive is missing or empty.")
    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
        if bad is not None:
            raise BackupError(f"The media archive is corrupt ({bad}).")
        count = len([n for n in zf.namelist() if not n.endswith("/")])
    if count != expected:
        raise BackupError(f"The media archive has {count} files, expected {expected}.")
    return count


def create_backup(now=None):
    """Create and verify one backup set. Returns the manifest dict. Raises BackupError."""
    now = now or timezone.now()
    base = Path(settings.BACKUP_DIR)
    base.mkdir(parents=True, exist_ok=True)
    _restrict(base)
    # manifest.json is written last and marks a complete, verified set; a folder without it
    # is an interrupted run and is never used for restore.
    folder = base / f"{PREFIX}{now.astimezone(datetime.UTC):%Y%m%d-%H%M%SZ}"
    work = folder
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    try:
        args, env, name = _db()
        dump = work / "database.dump"
        _run([pg_tool("pg_dump"), *args, "-d", name, "-Fc", "--no-owner", "--no-acl", "-f", str(dump)], env,
             "pg_dump")
        tables = verify_dump(dump)

        media_root = Path(settings.PRIVATE_MEDIA_ROOT)
        files = _media_files(media_root)
        archive = work / "media.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for f in files:
                zf.write(f, f.relative_to(media_root).as_posix())
        media_count = verify_zip(archive, len(files))

        manifest = {
            "created_at": now.isoformat(),
            "database": name,
            "verified": True,
            "table_data_entries": tables,
            "media_files": media_count,
            "files": {
                p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in (dump, archive)
            },
        }
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    except Exception:
        shutil.rmtree(work, ignore_errors=True)  # never leave a half-written set behind
        raise
    manifest["path"] = str(folder)
    if settings.BACKUP_COPY_DIR:
        manifest["copy"] = _copy_offsite(folder)
    return manifest


def _restrict(path):
    try:
        os.chmod(path, 0o700)  # owner only (effective on Linux/macOS)
    except OSError:
        pass


def _copy_offsite(folder):
    target_root = Path(settings.BACKUP_COPY_DIR)
    target_root.mkdir(parents=True, exist_ok=True)
    target = target_root / folder.name
    shutil.copytree(folder, target, dirs_exist_ok=True)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for name, meta in manifest["files"].items():
        if sha256(target / name) != meta["sha256"]:
            raise BackupError(f"The off-site copy of {name} does not match the original.")
    return str(target)


def prune(retention_days, now=None):
    """Delete verified sets older than the retention period. Returns the deleted folder names."""
    now = now or timezone.now()
    cutoff = now - datetime.timedelta(days=retention_days)
    deleted = []
    for folder in sorted(Path(settings.BACKUP_DIR).glob(f"{PREFIX}*")):
        if not folder.is_dir():
            continue
        try:
            stamp = datetime.datetime.strptime(folder.name[len(PREFIX):], "%Y%m%d-%H%M%SZ").replace(tzinfo=datetime.UTC)
        except ValueError:
            continue
        if stamp < cutoff:
            shutil.rmtree(folder)
            deleted.append(folder.name)
    return deleted


def verify_set(folder):
    """Re-check a set's checksums before restoring it."""
    folder = Path(folder)
    if not (folder / "manifest.json").is_file():
        raise BackupError("This folder has no manifest.json: it is not a complete backup set.")
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for name, meta in manifest["files"].items():
        if sha256(folder / name) != meta["sha256"]:
            raise BackupError(f"{name} does not match its checksum; the backup is damaged.")
    return manifest


def restore_database(folder, database=None):
    args, env, name = _db(database)
    _run(
        [pg_tool("pg_restore"), *args, "-d", name, "--clean", "--if-exists", "--no-owner", "--no-acl",
         "--exit-on-error", "--single-transaction", str(Path(folder) / "database.dump")],
        env,
        "pg_restore",
    )
    return name


def restore_media(folder, target=None):
    """Extract media.zip into PRIVATE_MEDIA_ROOT (or `target`). The current folder is kept
    alongside as <name>.before-restore-<time>. Archive paths may not escape the target."""
    target = Path(target or settings.PRIVATE_MEDIA_ROOT).resolve()
    if target.exists() and any(target.iterdir()):
        keep = target.with_name(f"{target.name}.before-restore-{timezone.now():%Y%m%d-%H%M%S}")
        target.rename(keep)
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(Path(folder) / "media.zip") as zf:
        for member in zf.namelist():
            dest = (target / member).resolve()
            if target != dest and target not in dest.parents:
                raise BackupError(f"Unsafe path in archive: {member}")
        zf.extractall(target)
    return str(target)
