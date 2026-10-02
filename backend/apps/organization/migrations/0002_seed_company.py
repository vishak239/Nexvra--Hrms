from django.db import migrations


def seed(apps, schema_editor):
    # Only the company name is known (from the project brief). All policy settings start empty.
    apps.get_model("organization", "Company").objects.get_or_create(pk=1, defaults={"name": "Nexvra Solutions"})
    apps.get_model("organization", "CompanySettings").objects.get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [("organization", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
