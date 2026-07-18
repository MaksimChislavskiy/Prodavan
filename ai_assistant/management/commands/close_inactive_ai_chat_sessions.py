from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai_assistant.maintenance import close_inactive_chat_sessions


class Command(BaseCommand):
    help = 'Закрывает неактивные AI-chat сессии, не удаляя историю сообщений.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--idle-minutes',
            type=int,
            default=settings.AI_CHAT_SESSION_IDLE_MINUTES,
            help='Таймаут неактивности в минутах.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Количество сессий, закрываемых за один пакет.',
        )

    def handle(self, *args, **options):
        if options['idle_minutes'] < 1:
            raise CommandError('--idle-minutes должен быть больше нуля.')
        if options['batch_size'] < 1:
            raise CommandError('--batch-size должен быть больше нуля.')

        closed = close_inactive_chat_sessions(
            idle_minutes=options['idle_minutes'],
            batch_size=options['batch_size'],
        )
        self.stdout.write(
            self.style.SUCCESS(
                f'Закрыто неактивных AI-chat сессий: {closed}.',
            ),
        )
