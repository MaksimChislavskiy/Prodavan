from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0005_alter_chatauditlog_action'),
    ]

    operations = [
        migrations.AlterField(
            model_name='message',
            name='text',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_type',
            field=models.CharField(
                blank=True,
                choices=[('image', 'Изображение'), ('document', 'Документ')],
                max_length=16,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_name',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_size',
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_mime_type',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='message',
            name='attachment_file',
            field=models.FileField(
                blank=True,
                max_length=500,
                null=True,
                upload_to='chat_attachments/%Y/%m/%d',
            ),
        ),
    ]
