from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ai_assistant', '0009_track_created_contacts'),
    ]

    operations = [
        migrations.AddField(
            model_name='aiauditlog',
            name='ip_address',
            field=models.GenericIPAddressField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='aiauditlog',
            name='new_value',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='aiauditlog',
            name='old_value',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='aiauditlog',
            name='user_agent',
            field=models.CharField(blank=True, default='', max_length=512),
        ),
    ]
