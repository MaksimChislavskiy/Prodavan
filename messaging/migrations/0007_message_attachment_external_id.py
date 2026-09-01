from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('messaging', '0006_message_attachments'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='attachment_external_id',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
    ]
