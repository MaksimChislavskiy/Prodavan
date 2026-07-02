from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('workspaces', '0002_workspace_settings'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspaceintegration',
            name='consecutive_failures',
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
