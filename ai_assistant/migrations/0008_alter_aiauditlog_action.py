from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ai_assistant', '0007_aiautomationauditlog_ip_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='aiauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('instruction_updated', 'Изменение инструкции'),
                    ('autopilot_enabled', 'Включение автопилота'),
                    ('autopilot_disabled', 'Выключение автопилота'),
                    ('autopilot_updated', 'Изменение автопилота'),
                    (
                        'ai_autopilot_settings_changed',
                        'Изменение настроек автопилота',
                    ),
                    ('document_uploaded', 'Загрузка документа'),
                    ('document_deleted', 'Удаление документа'),
                    ('document_retry', 'Повторная обработка документа'),
                ],
                max_length=32,
            ),
        ),
    ]
