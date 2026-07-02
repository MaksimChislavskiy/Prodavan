from django.core.management.base import BaseCommand

from workspaces.telegram_services import check_all_telegram_integrations


class Command(BaseCommand):
    help = 'Проверяет состояние всех подключённых Telegram-интеграций.'

    def handle(self, *args, **options):
        checked = check_all_telegram_integrations()
        self.stdout.write(
            self.style.SUCCESS(f'Проверено Telegram-интеграций: {checked}'),
        )
