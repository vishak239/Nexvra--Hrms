from django.db import migrations


def forwards(apps, schema_editor):
    # Owner policy (2026-10-03): 60 minutes of break per working day. Only fills an empty
    # value; a value HR already chose is kept.
    CompanySettings = apps.get_model("organization", "CompanySettings")
    CompanySettings.objects.filter(break_allowance_minutes__isnull=True).update(break_allowance_minutes=60)


class Migration(migrations.Migration):
    dependencies = [("organization", "0004_geofence_inactivity_overtime_settings")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
