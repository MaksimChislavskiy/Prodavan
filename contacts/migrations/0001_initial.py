import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('workspaces', '0004_telegram_webhook'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Contact',
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
                (
                    'id',
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ('name', models.CharField(max_length=100)),
                (
                    'name_search',
                    models.CharField(db_index=True, editable=False, max_length=100),
                ),
                (
                    'company',
                    models.CharField(blank=True, max_length=100, null=True),
                ),
                (
                    'phone',
                    models.CharField(blank=True, max_length=16, null=True),
                ),
                (
                    'email',
                    models.CharField(blank=True, max_length=255, null=True),
                ),
                (
                    'telegram',
                    models.CharField(blank=True, max_length=33, null=True),
                ),
                ('comment', models.TextField(blank=True, null=True)),
                ('version', models.PositiveIntegerField(default=1)),
                (
                    'telegram_user_id',
                    models.BigIntegerField(blank=True, null=True),
                ),
                (
                    'telegram_chat_id',
                    models.BigIntegerField(blank=True, null=True),
                ),
                (
                    'telegram_username',
                    models.CharField(blank=True, max_length=32, null=True),
                ),
                (
                    'is_deleted',
                    models.BooleanField(db_index=True, default=False),
                ),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                (
                    'workspace',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='contacts',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'contacts',
                'ordering': ('name', 'id'),
                'indexes': [
                    models.Index(
                        fields=['workspace', 'is_deleted'],
                        name='contacts_workspace_active_idx',
                    ),
                    models.Index(
                        fields=['workspace', 'phone'],
                        name='contacts_workspace_phone_idx',
                    ),
                    models.Index(
                        fields=['workspace', 'email'],
                        name='contacts_workspace_email_idx',
                    ),
                    models.Index(
                        fields=['workspace', 'telegram_user_id'],
                        name='contacts_workspace_tg_user_idx',
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name='ContactAuditLog',
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
                (
                    'action',
                    models.CharField(
                        choices=[
                            ('contact_created', 'Контакт создан'),
                            ('contact_updated', 'Контакт изменён'),
                            ('contact_deleted', 'Контакт удалён'),
                            (
                                'contacts_bulk_deleted',
                                'Контакты удалены массово',
                            ),
                        ],
                        max_length=32,
                    ),
                ),
                (
                    'contact_identifier',
                    models.UUIDField(blank=True, db_index=True, null=True),
                ),
                ('changes', models.JSONField(blank=True, default=dict)),
                (
                    'ip_address',
                    models.GenericIPAddressField(blank=True, null=True),
                ),
                ('user_agent', models.TextField(blank=True, default='')),
                (
                    'correlation_id',
                    models.UUIDField(default=uuid.uuid4, db_index=True),
                ),
                (
                    'created_at',
                    models.DateTimeField(auto_now_add=True, db_index=True),
                ),
                (
                    'user',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='contact_audit_logs',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'workspace',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='contact_audit_logs',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'contact_audit_log',
                'ordering': ('-created_at',),
            },
        ),
    ]
