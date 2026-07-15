from ai_assistant.processing import process_pending_knowledge_documents
from config.worker import QueueWorkerCommand


class Command(QueueWorkerCommand):
    help = 'Обрабатывает очередь документов базы знаний AI.'
    default_limit = 20
    max_limit = 100
    worker_name = 'AI knowledge worker'

    def process_batch(self, limit):
        return process_pending_knowledge_documents(limit=limit)

    def format_result(self, result):
        return (
            f"Обработано: {result['processed']}; "
            f"готово: {result['ready']}; ошибок: {result['failed']}."
        )
