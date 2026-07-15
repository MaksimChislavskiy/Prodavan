from config.worker import QueueWorkerCommand
from messaging.telegram import process_pending_telegram_webhooks


class Command(QueueWorkerCommand):
    help = 'Обрабатывает очередь входящих Telegram webhook.'
    worker_name = 'Telegram webhook worker'

    def process_batch(self, limit):
        return process_pending_telegram_webhooks(limit=limit)

    def format_result(self, result):
        return (
            f"Обработано: {result['processed']}; ошибок: {result['failed']}; "
            f"окончательных ошибок: {result['permanently_failed']}."
        )
