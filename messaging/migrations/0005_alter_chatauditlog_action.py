from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0004_alter_chatauditlog_action'),
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
                    (
                        'telegram_message_received',
                        'Telegram-сообщение получено',
                    ),
                    ('message_read', 'Сообщения прочитаны'),
                    ('chat_deleted', 'Чат удалён'),
                ],
                max_length=32,
            ),
        ),
    ]
