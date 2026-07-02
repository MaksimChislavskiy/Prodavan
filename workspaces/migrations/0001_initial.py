import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='Workspace',
            fields=[
                (
                    'created_at',
                    models.DateTimeField(auto_now_add=True, verbose_name='Дата создания'),
                ),
                (
                    'updated_at',
                    models.DateTimeField(auto_now=True, verbose_name='Дата обновления'),
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
                ('name', models.CharField(max_length=255, verbose_name='Название')),
            ],
            options={
                'verbose_name': 'Рабочее пространство',
                'verbose_name_plural': 'Рабочие пространства',
                'db_table': 'workspaces',
                'ordering': ('name',),
            },
        ),
    ]
