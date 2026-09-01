from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ai_assistant', '0010_aiauditlog_request_metadata'),
    ]

    operations = [
        migrations.AddField(
            model_name='knowledgedocument',
            name='onboarding_correlation_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
    ]
