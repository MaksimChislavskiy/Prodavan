from django.core.management.base import BaseCommand, CommandError

from users.maintenance import cleanup_expired_auth_records


class Command(BaseCommand):
    help = 'Удаляет истёкшие и отозванные временные записи аутентификации.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='Количество записей, удаляемых за один пакет (по умолчанию 1000).',
        )

    def handle(self, *args, **options):
        batch_size = options['batch_size']
        if batch_size < 1:
            raise CommandError('--batch-size должен быть больше нуля.')

        counters = cleanup_expired_auth_records(batch_size=batch_size)
        self.stdout.write(
            self.style.SUCCESS(
                'Очистка auth завершена: registration={registration_tokens}, '
                'password_reset={password_reset_tokens}, '
                'refresh={refresh_tokens}, '
                'email_reservations={email_reservations}, '
                'email_deliveries={auth_email_deliveries}, '
                'audit_logs={auth_audit_logs}, '
                'total={total}.'.format(**counters),
            ),
        )
