import uuid

import django.db.models.deletion
import users.models
from django.db import migrations, models
from django.db.models.functions import Lower


def create_workspaces_for_existing_users(apps, schema_editor):
    User = apps.get_model('users', 'User')
    Workspace = apps.get_model('workspaces', 'Workspace')

    for user in User.objects.filter(workspace__isnull=True).iterator():
        full_name = f'{user.first_name} {user.last_name}'.strip()
        workspace = Workspace.objects.create(
            name=f'Компания {full_name or user.email}'[:255],
        )
        user.workspace = workspace
        user.save(update_fields=('workspace',))


class Migration(migrations.Migration):
    dependencies = [
        ('workspaces', '0001_initial'),
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.RemoveField(model_name='user', name='username'),
        migrations.AlterField(
            model_name='user',
            name='email',
            field=models.EmailField(
                max_length=255,
                unique=True,
                verbose_name='Электронная почта',
            ),
        ),
        migrations.AlterField(
            model_name='user',
            name='first_name',
            field=models.CharField(max_length=50, verbose_name='Имя'),
        ),
        migrations.AlterField(
            model_name='user',
            name='last_name',
            field=models.CharField(max_length=50, verbose_name='Фамилия'),
        ),
        migrations.AddField(
            model_name='user',
            name='role',
            field=models.CharField(
                choices=[('admin', 'Администратор'), ('user', 'Пользователь')],
                default='admin',
                max_length=16,
                verbose_name='Роль',
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='is_confirmed',
            field=models.BooleanField(default=False, verbose_name='E-mail подтверждён'),
        ),
        migrations.AddField(
            model_name='user',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Дата удаления'),
        ),
        migrations.AddField(
            model_name='user',
            name='workspace',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='users',
                to='workspaces.workspace',
                verbose_name='Рабочее пространство',
            ),
        ),
        migrations.CreateModel(
            name='RegistrationToken',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('email', models.EmailField(max_length=255, unique=True)),
                ('name', models.CharField(max_length=50)),
                ('surname', models.CharField(max_length=50)),
                ('password_hash', models.CharField(max_length=128)),
                ('confirmation_code_hash', models.CharField(max_length=128)),
                ('code_expires_at', models.DateTimeField(db_index=True)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('expired', models.BooleanField(default=False)),
            ],
            options={
                'db_table': 'registration_tokens',
                'ordering': ('-created_at',),
            },
        ),
        migrations.CreateModel(
            name='PasswordResetToken',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('reset_code_hash', models.CharField(max_length=128)),
                ('code_expires_at', models.DateTimeField(db_index=True)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('used', models.BooleanField(default=False)),
                ('confirmed_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='password_reset_tokens', to='users.user')),
            ],
            options={
                'db_table': 'password_reset_tokens',
                'ordering': ('-created_at',),
            },
        ),
        migrations.CreateModel(
            name='RefreshToken',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Дата создания')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Дата обновления')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('token_hash', models.CharField(max_length=128, unique=True)),
                ('expires_at', models.DateTimeField(db_index=True)),
                ('revoked', models.BooleanField(db_index=True, default=False)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('replaced_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='replaces', to='users.refreshtoken')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='refresh_tokens', to='users.user')),
            ],
            options={
                'db_table': 'refresh_tokens',
                'ordering': ('-created_at',),
            },
        ),
        migrations.RunPython(
            create_workspaces_for_existing_users,
            migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name='user',
            name='workspace',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='users',
                to='workspaces.workspace',
                verbose_name='Рабочее пространство',
            ),
        ),
        migrations.AlterModelManagers(
            name='user',
            managers=[('objects', users.models.UserManager())],
        ),
        migrations.AddConstraint(
            model_name='user',
            constraint=models.UniqueConstraint(
                Lower('email'),
                name='users_email_ci_unique',
            ),
        ),
    ]
