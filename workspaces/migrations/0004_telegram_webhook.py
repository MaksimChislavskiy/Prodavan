import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('workspaces', '0003_telegram_health'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspaceintegration',
            name='credential_fingerprint',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name='workspaceintegration',
            name='webhook_secret_config',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='workspaceintegration',
            name='webhook_secret_hash',
            field=models.CharField(
                blank=True,
                db_index=True,
                default='',
                max_length=64,
            ),
        ),
        migrations.CreateModel(
            name='TelegramWebhookLog',
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
                ('update_id', models.BigIntegerField()),
                ('payload', models.JSONField()),
                (
                    'received_at',
                    models.DateTimeField(auto_now_add=True, db_index=True),
                ),
                (
                    'processed',
                    models.BooleanField(db_index=True, default=False),
                ),
                ('processing_error', models.TextField(blank=True, default='')),
                (
                    'workspace',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='telegram_webhook_logs',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'telegram_webhook_log',
                'ordering': ('-received_at', '-id'),
            },
        ),
        migrations.AddConstraint(
            model_name='workspaceintegration',
            constraint=models.UniqueConstraint(
                condition=(
                    models.Q(type='telegram')
                    & ~models.Q(credential_fingerprint='')
                ),
                fields=('credential_fingerprint',),
                name='unique_telegram_credential_fingerprint',
            ),
        ),
        migrations.AddConstraint(
            model_name='workspaceintegration',
            constraint=models.UniqueConstraint(
                condition=(
                    models.Q(type='telegram')
                    & ~models.Q(webhook_secret_hash='')
                ),
                fields=('webhook_secret_hash',),
                name='unique_telegram_webhook_secret_hash',
            ),
        ),
        migrations.AddConstraint(
            model_name='telegramwebhooklog',
            constraint=models.UniqueConstraint(
                fields=('workspace', 'update_id'),
                name='unique_telegram_update_per_workspace',
            ),
        ),
    ]
