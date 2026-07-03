import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('contacts', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Chat',
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
                ('last_message', models.TextField(blank=True, null=True)),
                (
                    'last_message_at',
                    models.DateTimeField(blank=True, db_index=True, null=True),
                ),
                ('unread_count', models.PositiveIntegerField(default=0)),
                (
                    'is_deleted',
                    models.BooleanField(db_index=True, default=False),
                ),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                (
                    'contact',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.RESTRICT,
                        related_name='chats',
                        to='contacts.contact',
                    ),
                ),
                (
                    'workspace',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='chats',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'chats',
                'ordering': ('-last_message_at', '-id'),
                'indexes': [
                    models.Index(
                        fields=[
                            'workspace',
                            'is_deleted',
                            '-last_message_at',
                            '-id',
                        ],
                        name='chats_workspace_recent_idx',
                    ),
                    models.Index(
                        fields=['contact'],
                        name='chats_contact_idx',
                    ),
                ],
                'constraints': [
                    models.UniqueConstraint(
                        condition=models.Q(('is_deleted', False)),
                        fields=('workspace', 'contact'),
                        name='unique_active_chat_per_contact',
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name='Message',
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
                (
                    'sender_type',
                    models.CharField(
                        choices=[
                            ('user', 'Пользователь CRM'),
                            ('contact', 'Контакт'),
                        ],
                        max_length=16,
                    ),
                ),
                ('sender_id', models.UUIDField(db_index=True)),
                ('text', models.TextField()),
                (
                    'status',
                    models.CharField(
                        blank=True,
                        choices=[
                            ('sent', 'Отправлено'),
                            ('delivered', 'Доставлено'),
                            ('failed', 'Ошибка'),
                        ],
                        max_length=16,
                        null=True,
                    ),
                ),
                (
                    'read_at',
                    models.DateTimeField(blank=True, db_index=True, null=True),
                ),
                ('sent_by_ai', models.BooleanField(default=False)),
                (
                    'source_update_id',
                    models.BigIntegerField(blank=True, null=True),
                ),
                (
                    'is_deleted',
                    models.BooleanField(db_index=True, default=False),
                ),
                (
                    'chat',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='messages',
                        to='messaging.chat',
                    ),
                ),
            ],
            options={
                'db_table': 'messages',
                'ordering': ('created_at', 'id'),
                'indexes': [
                    models.Index(
                        fields=['chat', '-created_at', '-id'],
                        name='messages_chat_recent_idx',
                    ),
                    models.Index(
                        fields=['chat', 'read_at'],
                        name='messages_chat_read_idx',
                    ),
                ],
                'constraints': [
                    models.CheckConstraint(
                        check=(
                            models.Q(
                                ('sender_type', 'contact'),
                                ('status__isnull', True),
                            )
                            | models.Q(
                                ('sender_type', 'user'),
                                ('status__isnull', False),
                            )
                        ),
                        name='message_status_matches_sender',
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(('source_update_id__isnull', False)),
                        fields=('chat', 'source_update_id'),
                        name='unique_telegram_update_per_chat',
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name='ChatAuditLog',
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
                            ('chat_created', 'Чат создан'),
                            ('message_sent', 'Сообщение отправлено'),
                            ('message_received', 'Сообщение получено'),
                            ('message_read', 'Сообщения прочитаны'),
                            ('chat_deleted', 'Чат удалён'),
                        ],
                        max_length=32,
                    ),
                ),
                (
                    'chat_identifier',
                    models.UUIDField(blank=True, db_index=True, null=True),
                ),
                (
                    'message_identifier',
                    models.UUIDField(blank=True, db_index=True, null=True),
                ),
                ('details', models.JSONField(blank=True, default=dict)),
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
                        related_name='chat_audit_logs',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'workspace',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='chat_audit_logs',
                        to='workspaces.workspace',
                    ),
                ),
            ],
            options={
                'db_table': 'chat_audit_log',
                'ordering': ('-created_at',),
            },
        ),
    ]
