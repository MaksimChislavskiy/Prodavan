import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('workspaces', '0005_telegram_webhook_retry'),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkspaceOnboarding',
            fields=[
                (
                    'created_at',
                    models.DateTimeField(
                        auto_now_add=True,
                        verbose_name='Дата создания',
                    ),
                ),
                (
                    'updated_at',
                    models.DateTimeField(
                        auto_now=True,
                        verbose_name='Дата обновления',
                    ),
                ),
                ('completed', models.BooleanField(default=False)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('materials_viewed', models.BooleanField(default=False)),
                (
                    'workspace',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name='onboarding',
                        serialize=False,
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={'db_table': 'workspace_onboarding'},
        ),
        migrations.CreateModel(
            name='WorkspaceOnboardingAuditLog',
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
                ('workspace_identifier', models.UUIDField(db_index=True)),
                (
                    'user_identifier',
                    models.UUIDField(blank=True, db_index=True, null=True),
                ),
                (
                    'event',
                    models.CharField(
                        choices=[
                            ('onboarding_upload_started', 'Загрузка начата'),
                            ('onboarding_upload_success', 'Загрузка принята'),
                            ('onboarding_upload_failed', 'Ошибка загрузки'),
                            ('onboarding_materials_viewed', 'Материалы просмотрены'),
                            ('onboarding_completed', 'Онбординг завершён'),
                        ],
                        db_index=True,
                        max_length=64,
                    ),
                ),
                ('details', models.JSONField(blank=True, default=dict)),
                (
                    'ip_address',
                    models.GenericIPAddressField(blank=True, null=True),
                ),
                ('user_agent', models.CharField(blank=True, default='', max_length=512)),
                ('correlation_id', models.CharField(db_index=True, max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    'user',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='onboarding_audit_logs',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'workspace',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='onboarding_audit_logs',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'workspace_onboarding_audit_log',
                'ordering': ('-created_at', '-id'),
            },
        ),
    ]
