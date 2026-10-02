from django.core.management.base import BaseCommand

from apps.accounts.models import Permission, Role
from apps.accounts.rbac import sync_rbac


class Command(BaseCommand):
    help = "Create missing permissions/roles from apps/accounts/rbac.py (idempotent, never revokes)."

    def handle(self, *args, **options):
        sync_rbac(Permission, Role)
        self.stdout.write(self.style.SUCCESS(f"{Permission.objects.count()} permissions, {Role.objects.count()} roles"))
