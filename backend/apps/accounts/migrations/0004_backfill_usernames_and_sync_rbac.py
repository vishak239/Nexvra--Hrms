from django.db import migrations


def forwards(apps, schema_editor):
    from apps.accounts.rbac import sync_rbac
    from apps.accounts.usernames import generate_unique

    User = apps.get_model("accounts", "User")
    for user in User.objects.filter(username__isnull=True).order_by("pk"):
        user.username = generate_unique(User, user.email, exclude_pk=user.pk)
        user.save(update_fields=["username"])
    # Grants the new task / messaging permissions to the system roles that hold them by default.
    sync_rbac(apps.get_model("accounts", "Permission"), apps.get_model("accounts", "Role"))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_user_username")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
