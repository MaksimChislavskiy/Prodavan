from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('users', '0005_auth_email_delivery_and_audit'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='first_name',
            field=models.CharField(max_length=50, verbose_name='Имя'),
        ),
        migrations.AddField(
            model_name='registrationtoken',
            name='used',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='registrationtoken',
            name='is_confirmed',
            field=models.BooleanField(default=False),
        ),
    ]