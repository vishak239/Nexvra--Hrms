"""Runs a Django management command without a console window (Task Scheduler + pythonw).
Output goes to logs/scheduled-tasks.log in the repository root."""

import os
import pathlib
import sys
import traceback

ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
LOG = ROOT / "logs" / "scheduled-tasks.log"
LOG.parent.mkdir(exist_ok=True)

with open(LOG, "a", encoding="utf-8") as log:
    sys.stdout = sys.stderr = log
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    code = 0
    try:
        from django.core.management import execute_from_command_line

        execute_from_command_line(["manage.py", *sys.argv[1:]])
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 1
    except Exception:  # keep the reason in the log
        traceback.print_exc()
        code = 1
sys.exit(code)
