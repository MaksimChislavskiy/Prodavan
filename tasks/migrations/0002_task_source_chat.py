from django.db import migrations, models
import django.db.models.deletion


def backfill_source_chat(apps, schema_editor):
    Task = apps.get_model('tasks', 'Task')
    Chat = apps.get_model('messaging', 'Chat')
    tasks = Task.objects.filter(
        created_by_ai=True,
        source_chat__isnull=True,
        contact_id__isnull=False,
    ).iterator()
    for task in tasks:
        chat_id = (
            Chat.objects.filter(
                workspace_id=task.workspace_id,
                contact_id=task.contact_id,
                is_deleted=False,
            )
            .values_list('id', flat=True)
            .first()
        )
        if chat_id is not None:
            Task.objects.filter(id=task.id).update(source_chat_id=chat_id)


class Migration(migrations.Migration):
    dependencies = [
        ('messaging', '0005_alter_chatauditlog_action'),
        ('tasks', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='source_chat',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='ai_created_tasks',
                to='messaging.chat',
            ),
        ),
        migrations.RunPython(backfill_source_chat, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(
                fields=['source_chat', 'created_at'],
                name='tasks_source_chat_created_idx',
            ),
        ),
    ]
