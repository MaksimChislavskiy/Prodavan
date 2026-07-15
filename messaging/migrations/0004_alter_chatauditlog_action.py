from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0003_chat_ai_autopilot_enabled'),
    ]

    operations = [
        migrations.AlterField(
            model_name='chatauditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('chat_created', 'Чат создан'),
                    ('message_sent', 'Сообщение отправлено'),
                    (
                        'telegram_message_sent',
                        'Telegram-сообщение отправлено',
                    ),
                    ('message_received', 'Сообщение получено'),
                    ('message_read', 'Сообщения прочитаны'),
                    ('chat_deleted', 'Чат удалён'),
                ],
                max_length=32,
            ),
        ),
    ]
