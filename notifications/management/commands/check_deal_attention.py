from django.core.management.base import BaseCommand

from notifications.deal_attention import create_deal_attention_notifications


class Command(BaseCommand):
    help = 'Создаёт уведомления о сделках с открытыми просроченными задачами.'

    def handle(self, *args, **options):
        counters = create_deal_attention_notifications()
        self.stdout.write(
            self.style.SUCCESS(
                'Создано уведомлений: {notifications_created}. '
                'Сделок требуют внимания: {deals_requiring_attention}. '
                'Просроченных задач в сделках: {overdue_tasks}.'.format(
                    **counters,
                ),
            ),
        )
