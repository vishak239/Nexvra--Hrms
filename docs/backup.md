# Backups and restore

`manage.py backup_hrms` backs up the **PostgreSQL database** and the **private files** (documents, photos, message attachments) into one verified, timestamped set.

```
BACKUP_DIR/
  backup.log                                  one line per run: OK ... or FAILED ...
  nexvra-backup-20261003-023000Z/
    database.dump    pg_dump custom format (compressed)
    media.zip        everything under PRIVATE_MEDIA_ROOT
    manifest.json    created_at, sizes, SHA-256 checksums, verification results
```

## How a backup is verified

A run counts as successful only if all of these pass. Otherwise it exits with code 1.

1. `pg_dump` exits successfully and the dump is not empty.
2. `pg_restore --list` can read the dump, and it contains table data, including the HRMS attendance table.
3. The zip passes an integrity test, and its file count equals the number of files in `PRIVATE_MEDIA_ROOT`.
4. SHA-256 checksums are written to `manifest.json`. `manifest.json` is written last, so a set without it is incomplete and is never used for a restore.
5. If `BACKUP_COPY_DIR` is set, the copy is checksum-verified too.

On failure:

- partial files are deleted;
- `FAILED: <reason>` is written to `backup.log` and the log;
- Super Admins get an in-app "Backup failed" notification;
- the exit code is 1, which systemd and Task Scheduler record.

Credentials go to `pg_dump` through the `PGPASSWORD` environment variable, never on the command line or in logs.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `<repo>/backups` | Where sets are written. Must not be inside a web-served or media folder (`check --deploy` warns). The folder is owner-only on Linux. |
| `BACKUP_RETENTION_DAYS` | 14 | Older sets are deleted after each successful run |
| `BACKUP_COPY_DIR` | (none) | Optional second location (mounted network share or synced folder); verified by checksum |
| `PG_BIN_DIR` | (auto) | Folder containing `pg_dump`/`pg_restore` if they are not on `PATH` (Windows: found automatically in `C:\Program Files\PostgreSQL\16\bin`) |

## Schedule

- **Linux server:** `nexvra-backup.timer`, daily at 02:30 (see [deployment.md](deployment.md)).
- **This Windows PC:** run `powershell -ExecutionPolicy Bypass -File deploy\windows\register-scheduled-tasks.ps1`. It registers "Nexvra HRMS - backup" (daily 02:30) and "Nexvra HRMS - attendance rules" (every 2 minutes) for the current user. Output goes to `logs\scheduled-tasks.log`. Add `-Remove` to unregister both.

## Off-site copies

A backup on the same disk does not survive a disk failure or a lost server. Copy `BACKUP_DIR` elsewhere at least daily. Either:

- set `BACKUP_COPY_DIR` to a mounted network share; or
- run a sync tool after the backup timer, for example `rclone sync /var/backups/nexvra-hrms remote:nexvra-hrms-backups` to any S3-compatible or cloud storage, with server-side encryption.

The backups contain personal data, so encrypt them in transit and at rest, and restrict who can read them.

## Restore

Restoring **replaces** the current data. Stop the application first: `sudo systemctl stop nexvra-backend nexvra-frontend` on Linux, or `stop-hrms.bat` on Windows.

```bash
cd backend
# 1. Practice / check a backup without touching live data:
#    (create an empty database first: createdb -O nexvra nexvra_hrms_restore_test)
.venv/bin/python manage.py restore_hrms /var/backups/nexvra-hrms/nexvra-backup-20261003-023000Z \
    --database nexvra_hrms_restore_test --media-target /tmp/restore-check --yes

# 2. Real restore (database + files):
.venv/bin/python manage.py restore_hrms /var/backups/nexvra-hrms/nexvra-backup-20261003-023000Z --yes
.venv/bin/python manage.py migrate        # brings an older backup up to the current schema
```

`restore_hrms` takes these steps:

1. It checks every checksum first.
2. It restores the database with `pg_restore --clean --if-exists --single-transaction --exit-on-error`, so a failed restore changes nothing.
3. It extracts the files. The current media folder is kept beside it as `private_media.before-restore-<time>`, and archive paths that would escape the target folder are refused.

Options: `--skip-database`, `--skip-media`, `--database <name>`, `--media-target <dir>`.

Restoring by hand without the app is also possible:

- `pg_restore -h localhost -U nexvra -d nexvra_hrms --clean --if-exists --no-owner database.dump`
- unzip `media.zip` into `PRIVATE_MEDIA_ROOT`.

**Do a test restore after setting up backups, and then regularly.** A backup that has never been restored is not proven.
