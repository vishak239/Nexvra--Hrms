from django.db import migrations


def forwards(apps, schema_editor):
    from apps.accounts.rbac import sync_rbac

    # Grants the new policies.manage permission to the system roles that hold it by default.
    sync_rbac(apps.get_model("accounts", "Permission"), apps.get_model("accounts", "Role"))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0004_backfill_usernames_and_sync_rbac")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
