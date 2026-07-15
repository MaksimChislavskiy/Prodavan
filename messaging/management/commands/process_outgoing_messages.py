from config.worker import QueueWorkerCommand
from messaging.outgoing import process_pending_outgoing_messages


class Command(QueueWorkerCommand):
    help = 'Отправляет очередь исходящих сообщений через Telegram.'
    worker_name = 'Telegram outgoing worker'

    def process_batch(self, limit):
        return process_pending_outgoing_messages(limit=limit)

    def format_result(self, result):
        return f'Обработано исходящих сообщений: {result}.'
