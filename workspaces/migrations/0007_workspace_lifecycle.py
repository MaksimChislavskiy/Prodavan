from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0006_workspace_onboarding'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='is_active',
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.AddField(
            model_name='workspace',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
