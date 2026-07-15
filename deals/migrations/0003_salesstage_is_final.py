from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('deals', '0002_deal_ai_insights'),
    ]

    operations = [
        migrations.AddField(
            model_name='salesstage',
            name='is_final',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
