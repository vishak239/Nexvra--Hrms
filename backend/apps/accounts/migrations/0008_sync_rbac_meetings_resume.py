from django.db import migrations


def forwards(apps, schema_editor):
    from apps.accounts.rbac import sync_rbac

    # Grants meetings.manage / resume.approve to the system roles that hold them by default.
    sync_rbac(apps.get_model("accounts", "Permission"), apps.get_model("accounts", "Role"))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0007_remove_user_must_change_password")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
