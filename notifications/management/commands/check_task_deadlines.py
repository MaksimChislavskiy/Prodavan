from django.core.management.base import BaseCommand

from notifications.task_deadlines import create_task_deadline_notifications


class Command(BaseCommand):
    help = 'Создаёт уведомления по задачам с приближающимся или просроченным сроком.'

    def handle(self, *args, **options):
        counters = create_task_deadline_notifications()
        self.stdout.write(
            self.style.SUCCESS(
                'Создано уведомлений: {notifications_created}. '
                'Задач со сроком скоро: {due_soon_tasks}. '
                'Просроченных задач: {overdue_tasks}.'.format(**counters),
            ),
        )
