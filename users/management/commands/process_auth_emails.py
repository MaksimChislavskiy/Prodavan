from config.worker import QueueWorkerCommand
from users.email_delivery import process_pending_auth_emails


class Command(QueueWorkerCommand):
    help = 'Повторно отправляет служебные письма регистрации и восстановления.'
    worker_name = 'Auth email worker'

    def process_batch(self, limit):
        return process_pending_auth_emails(limit=limit)

    def format_result(self, result):
        return f'Обработано служебных писем: {result}.'
