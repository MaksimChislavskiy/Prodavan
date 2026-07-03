import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('contacts', '0001_initial'),
        ('deals', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Task',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True, max_length=1000, null=True)),
                ('due_date', models.DateTimeField(blank=True, null=True)),
                ('due_date_type', models.CharField(choices=[('datetime', 'Дата и время'), ('date', 'Дата'), ('none', 'Без срока')], default='none', max_length=16)),
                ('status', models.CharField(choices=[('new', 'Новая'), ('in_progress', 'В работе'), ('done', 'Выполнена')], default='new', max_length=16)),
                ('comment', models.TextField(blank=True, max_length=500, null=True)),
                ('created_by_ai', models.BooleanField(default=False)),
                ('version', models.PositiveIntegerField(default=1)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('contact', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tasks', to='contacts.contact')),
                ('created_by_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_tasks', to=settings.AUTH_USER_MODEL)),
                ('deal', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tasks', to='deals.deal')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tasks', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'tasks',
                'ordering': ('due_date', '-created_at', '-id'),
            },
        ),
        migrations.CreateModel(
            name='TaskAuditLog',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('task_identifier', models.UUIDField(blank=True, db_index=True, null=True)),
                ('event', models.CharField(choices=[('task_created', 'Задача создана'), ('task_updated', 'Задача изменена'), ('task_deleted', 'Задача удалена'), ('tasks_bulk_deleted', 'Задачи удалены массово')], max_length=32)),
                ('source', models.CharField(choices=[('user', 'Пользователь'), ('ai', 'AI'), ('system', 'Система')], max_length=16)),
                ('details', models.JSONField(blank=True, default=dict)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.TextField(blank=True, default='')),
                ('correlation_id', models.UUIDField(db_index=True, default=uuid.uuid4)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='task_audit_logs', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='task_audit_logs', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'task_audit_log',
                'ordering': ('-created_at', '-id'),
            },
        ),
        migrations.CreateModel(
            name='TaskHistory',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('event', models.CharField(choices=[('task_created', 'Задача создана'), ('task_updated', 'Задача изменена'), ('task_deleted', 'Задача удалена'), ('tasks_bulk_deleted', 'Задачи удалены массово')], max_length=32)),
                ('source', models.CharField(choices=[('user', 'Пользователь'), ('ai', 'AI'), ('system', 'Система')], default='user', max_length=16)),
                ('data', models.JSONField(blank=True, default=dict)),
                ('changes', models.JSONField(blank=True, default=dict)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.TextField(blank=True, default='')),
                ('correlation_id', models.UUIDField(db_index=True, default=uuid.uuid4)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history', to='tasks.task')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='task_history_entries', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='task_history', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'task_history',
                'ordering': ('-created_at', '-id'),
            },
        ),
        migrations.CreateModel(
            name='TaskIdempotencyRecord',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('key', models.CharField(max_length=255)),
                ('request_hash', models.CharField(max_length=64)),
                ('response_body', models.JSONField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='task_idempotency_records', to='workspaces.workspace')),
            ],
            options={'db_table': 'task_idempotency_records'},
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['workspace', 'status', 'is_deleted', 'due_date', '-created_at', '-id'], name='tasks_kanban_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['contact'], name='tasks_contact_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['deal'], name='tasks_deal_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['workspace', 'created_at'], name='tasks_workspace_created_idx'),
        ),
        migrations.AddIndex(
            model_name='taskhistory',
            index=models.Index(fields=['task', '-created_at'], name='task_history_created_idx'),
        ),
        migrations.AddConstraint(
            model_name='taskidempotencyrecord',
            constraint=models.UniqueConstraint(fields=('workspace', 'key'), name='unique_task_idempotency_key'),
        ),
    ]
