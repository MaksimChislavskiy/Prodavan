from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0007_workspace_lifecycle'),
    ]

    operations = [
        migrations.RenameField(
            model_name='workspaceonboardingauditlog',
            old_name='ip_address',
            new_name='ip',
        ),
        migrations.AlterField(
            model_name='workspaceonboardingauditlog',
            name='event',
            field=models.CharField(
                choices=[
                    ('onboarding_upload_started', 'Загрузка начата'),
                    ('onboarding_upload_success', 'Загрузка принята'),
                    ('onboarding_upload_failed', 'Ошибка загрузки'),
                    ('onboarding_video_opened', 'Видео открыто'),
                    ('onboarding_pdf_opened', 'PDF открыт'),
                    ('onboarding_materials_viewed', 'Материалы просмотрены'),
                    ('onboarding_completed', 'Онбординг завершён'),
                ],
                db_index=True,
                max_length=64,
            ),
        ),
        migrations.AlterField(
            model_name='workspaceonboarding',
            name='completed',
            field=models.BooleanField(
                db_column='onboarding_completed',
                default=False,
            ),
        ),
        migrations.AlterField(
            model_name='workspaceonboarding',
            name='completed_at',
            field=models.DateTimeField(
                blank=True,
                db_column='onboarding_completed_at',
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name='workspaceonboarding',
            name='materials_viewed',
            field=models.BooleanField(
                db_column='onboarding_materials_viewed',
                default=False,
            ),
        ),
    ]
