"""Apply the time-based attendance rules for everyone (break allowance, inactivity check-out,
overtime auto-stop). Idempotent; schedule it every few minutes (systemd timer / Task Scheduler).
The same rules also run whenever an employee's browser reports activity or loads the session."""

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.attendance.activity import reconcile_all


class Command(BaseCommand):
    help = "Apply break-allowance, inactivity and overtime auto-stop rules to open work sessions."

    def add_arguments(self, parser):
        parser.add_argument("--quiet", action="store_true", help="Print only when a rule changed something.")

    def handle(self, *args, **options):
        totals = reconcile_all()
        if options["quiet"] and not (totals["checked_out"] or totals["overtime_stopped"] or totals["break_ended"]):
            return
        message = (
            "Reconciled {employees} employee(s): {checked_out} automatic check-out(s), "
            "{overtime_stopped} overtime stop(s), {break_ended} break(s) ended at the allowance."
        ).format(**totals)
        self.stdout.write(f"{timezone.now().isoformat()} {message}")
