from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('ai_assistant', '0008_alter_aiauditlog_action'),
    ]

    operations = [
        migrations.AddField(
            model_name='aiautomationevent',
            name='contact_created',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='aiprocessedevent',
            name='action_type',
            field=models.CharField(
                choices=[
                    ('contact_create', 'Создание контакта'),
                    ('contact_enrichment', 'Обогащение контакта'),
                    ('deal_create', 'Создание сделки'),
                    ('deal_enrichment', 'Обогащение сделки'),
                    ('task_create', 'Создание задачи'),
                    ('insight', 'Инсайт по чату'),
                    ('autopilot_reply', 'Ответ автопилота'),
                ],
                max_length=32,
            ),
        ),
    ]
