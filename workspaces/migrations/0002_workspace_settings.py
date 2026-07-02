import uuid

import django.db.models.deletion
import workspaces.models
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('workspaces', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspace',
            name='timezone',
            field=models.CharField(default='UTC', max_length=64),
        ),
        migrations.AddField(
            model_name='workspace',
            name='language',
            field=models.CharField(default='ru', max_length=8),
        ),
        migrations.AddField(
            model_name='workspace',
            name='version',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='workspace',
            name='company',
            field=models.JSONField(default=workspaces.models.default_company_details),
        ),
        migrations.CreateModel(
            name='WorkspaceIntegration',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('type', models.CharField(choices=[('telegram', 'Telegram'), ('whatsapp', 'WhatsApp'), ('email', 'Email')], max_length=32)),
                ('status', models.CharField(choices=[('connected', 'Подключено'), ('disconnected', 'Отключено')], db_index=True, default='disconnected', max_length=16)),
                ('health_status', models.CharField(blank=True, choices=[('healthy', 'Работает'), ('degraded', 'Есть проблемы'), ('error', 'Ошибка')], max_length=16, null=True)),
                ('config', models.JSONField(blank=True, default=dict)),
                ('bot_username', models.CharField(blank=True, default='', max_length=255)),
                ('connected_at', models.DateTimeField(blank=True, null=True)),
                ('last_check_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('last_error', models.TextField(blank=True, default='')),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='integrations', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'workspace_integrations',
                'ordering': ('type',),
            },
        ),
        migrations.CreateModel(
            name='WorkspaceAuditLog',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('user_identifier', models.UUIDField(db_index=True)),
                ('workspace_identifier', models.UUIDField(db_index=True)),
                ('field', models.CharField(max_length=128)),
                ('old_value', models.TextField(blank=True, null=True)),
                ('new_value', models.TextField(blank=True, null=True)),
                ('changed_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('request_id', models.UUIDField(db_index=True, default=uuid.uuid4)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workspace_audit_logs', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='audit_logs', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'workspace_audit_log',
                'ordering': ('-changed_at',),
            },
        ),
        migrations.CreateModel(
            name='WorkspaceIdempotencyRecord',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('key', models.UUIDField()),
                ('request_hash', models.CharField(max_length=64)),
                ('response_body', models.JSONField()),
                ('response_status', models.PositiveSmallIntegerField(default=200)),
                ('response_etag', models.CharField(max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='workspace_idempotency_records', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='idempotency_records', to='workspaces.workspace')),
            ],
            options={'db_table': 'workspace_idempotency_records'},
        ),
        migrations.AddConstraint(
            model_name='workspaceintegration',
            constraint=models.UniqueConstraint(fields=('workspace', 'type'), name='unique_workspace_integration_type'),
        ),
        migrations.AddConstraint(
            model_name='workspaceidempotencyrecord',
            constraint=models.UniqueConstraint(fields=('workspace', 'key'), name='unique_workspace_idempotency_key'),
        ),
    ]
