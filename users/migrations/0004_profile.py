import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('users', '0003_user_token_version'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='first_name',
            field=models.CharField(max_length=100, verbose_name='Имя'),
        ),
        migrations.AlterField(
            model_name='user',
            name='avatar',
            field=models.ImageField(
                blank=True,
                default=None,
                null=True,
                upload_to='avatars/original/',
                verbose_name='Аватар',
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='position',
            field=models.CharField(
                blank=True,
                default='',
                max_length=100,
                verbose_name='Должность',
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='is_deleted',
            field=models.BooleanField(default=False, verbose_name='Удалён'),
        ),
        migrations.AddField(
            model_name='user',
            name='version',
            field=models.PositiveIntegerField(default=0, verbose_name='Версия профиля'),
        ),
        migrations.AddField(
            model_name='user',
            name='avatar_small',
            field=models.ImageField(
                blank=True,
                default=None,
                null=True,
                upload_to='avatars/40/',
                verbose_name='Аватар 40×40',
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='avatar_medium',
            field=models.ImageField(
                blank=True,
                default=None,
                null=True,
                upload_to='avatars/160/',
                verbose_name='Аватар 160×160',
            ),
        ),
        migrations.CreateModel(
            name='DeletedEmailReservation',
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
                ('email_hash', models.CharField(max_length=64, unique=True)),
                ('user_identifier', models.UUIDField(db_index=True)),
                ('deleted_at', models.DateTimeField()),
                ('release_at', models.DateTimeField(db_index=True)),
            ],
            options={
                'db_table': 'deleted_email_reservations',
                'ordering': ('-deleted_at',),
            },
        ),
        migrations.CreateModel(
            name='ProfileAuditLog',
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
                    'user_identifier',
                    models.UUIDField(db_index=True),
                ),
                (
                    'action',
                    models.CharField(
                        choices=[
                            ('profile_updated', 'Изменение профиля'),
                            ('avatar_uploaded', 'Загрузка аватара'),
                            ('avatar_deleted', 'Удаление аватара'),
                            ('password_changed', 'Смена пароля'),
                            ('account_deleted', 'Удаление аккаунта'),
                        ],
                        max_length=32,
                    ),
                ),
                ('changes', models.JSONField(blank=True, default=dict)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    'user',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='profile_audit_logs',
                        to='users.user',
                    ),
                ),
            ],
            options={
                'db_table': 'profile_audit_logs',
                'ordering': ('-created_at',),
            },
        ),
    ]
