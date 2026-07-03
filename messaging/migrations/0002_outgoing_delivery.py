import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('messaging', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='delivered_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='delivery_attempts',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='message',
            name='last_delivery_error',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='message',
            name='next_delivery_attempt_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='telegram_message_id',
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='MessageIdempotencyRecord',
            fields=[
                (
                    'id',
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ('key', models.CharField(max_length=255)),
                ('request_hash', models.CharField(max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                (
                    'chat',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='idempotency_records',
                        to='messaging.chat',
                    ),
                ),
                (
                    'message',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='idempotency_record',
                        to='messaging.message',
                    ),
                ),
                (
                    'user',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='message_idempotency_records',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'workspace',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='message_idempotency_records',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'message_idempotency_records',
                'constraints': [
                    models.UniqueConstraint(
                        fields=('workspace', 'key'),
                        name='unique_message_idempotency_key',
                    ),
                ],
            },
        ),
    ]
