import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def create_system_stages(apps, schema_editor):
    Workspace = apps.get_model('workspaces', 'Workspace')
    SalesStage = apps.get_model('deals', 'SalesStage')
    for workspace_id in Workspace.objects.values_list('id', flat=True).iterator():
        SalesStage.objects.get_or_create(
            workspace_id=workspace_id,
            is_system=True,
            defaults={
                'name': 'Новый лид',
                'name_normalized': 'новый лид',
                'order': 1,
            },
        )


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('contacts', '0001_initial'),
        ('workspaces', '0004_telegram_webhook'),
    ]

    operations = [
        migrations.CreateModel(
            name='SalesStage',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=100)),
                ('name_normalized', models.CharField(editable=False, max_length=100)),
                ('is_system', models.BooleanField(default=False)),
                ('order', models.PositiveSmallIntegerField()),
                ('version', models.PositiveIntegerField(default=1)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sales_stages', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'sales_stages',
                'ordering': ('order', 'id'),
            },
        ),
        migrations.CreateModel(
            name='Deal',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=255)),
                ('amount', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('currency', models.CharField(default='RUB', max_length=3)),
                ('comment', models.CharField(blank=True, max_length=500, null=True)),
                ('version', models.PositiveIntegerField(default=1)),
                ('is_deleted', models.BooleanField(db_index=True, default=False)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('contact', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='deals', to='contacts.contact')),
                ('stage', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='deals', to='deals.salesstage')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='deals', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'deals',
                'ordering': ('-updated_at', '-id'),
            },
        ),
        migrations.CreateModel(
            name='DealIdempotencyRecord',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('operation', models.CharField(max_length=32)),
                ('key', models.CharField(max_length=255)),
                ('request_hash', models.CharField(max_length=64)),
                ('response_body', models.JSONField()),
                ('response_status', models.PositiveSmallIntegerField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='deal_idempotency_records', to='workspaces.workspace')),
            ],
            options={'db_table': 'deal_idempotency_records'},
        ),
        migrations.CreateModel(
            name='DealHistory',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('event_type', models.CharField(choices=[('deal_created', 'Сделка создана'), ('deal_updated', 'Сделка изменена'), ('deal_stage_changed', 'Этап сделки изменён'), ('deal_deleted', 'Сделка удалена')], max_length=32)),
                ('changed_by_type', models.CharField(choices=[('user', 'Пользователь'), ('ai', 'AI'), ('system', 'Система')], default='user', max_length=16)),
                ('changes', models.JSONField(blank=True, default=dict)),
                ('reason', models.CharField(blank=True, max_length=64, null=True)),
                ('correlation_id', models.UUIDField(db_index=True, default=uuid.uuid4)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('changed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='deal_history_entries', to=settings.AUTH_USER_MODEL)),
                ('deal', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history', to='deals.deal')),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='deal_history', to='workspaces.workspace')),
            ],
            options={
                'db_table': 'deal_history',
                'ordering': ('-created_at', '-id'),
            },
        ),
        migrations.AddIndex(
            model_name='deal',
            index=models.Index(fields=['workspace', 'stage', '-updated_at', '-id'], name='deals_stage_sort_idx'),
        ),
        migrations.AddIndex(
            model_name='deal',
            index=models.Index(fields=['workspace', 'is_deleted'], name='deals_workspace_active_idx'),
        ),
        migrations.AddIndex(
            model_name='deal',
            index=models.Index(fields=['workspace', 'created_at'], name='deals_workspace_created_idx'),
        ),
        migrations.AddIndex(
            model_name='dealhistory',
            index=models.Index(fields=['deal', '-created_at'], name='deal_history_created_idx'),
        ),
        migrations.AddIndex(
            model_name='dealhistory',
            index=models.Index(fields=['workspace', 'event_type', '-created_at'], name='deal_history_event_idx'),
        ),
        migrations.AddConstraint(
            model_name='salesstage',
            constraint=models.UniqueConstraint(condition=models.Q(('is_deleted', False)), fields=('workspace', 'name_normalized'), name='unique_active_stage_name_per_workspace'),
        ),
        migrations.AddConstraint(
            model_name='salesstage',
            constraint=models.UniqueConstraint(condition=models.Q(('is_deleted', False)), fields=('workspace', 'order'), name='unique_active_stage_order_per_workspace'),
        ),
        migrations.AddConstraint(
            model_name='salesstage',
            constraint=models.UniqueConstraint(condition=models.Q(('is_deleted', False), ('is_system', True)), fields=('workspace',), name='unique_system_stage_per_workspace'),
        ),
        migrations.AddConstraint(
            model_name='dealidempotencyrecord',
            constraint=models.UniqueConstraint(fields=('workspace', 'operation', 'key'), name='unique_deal_idempotency_key'),
        ),
        migrations.RunPython(create_system_stages, migrations.RunPython.noop),
    ]
