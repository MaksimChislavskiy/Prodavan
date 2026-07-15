from ai_assistant.automation import process_pending_automation_events
from config.worker import QueueWorkerCommand


class Command(QueueWorkerCommand):
    help = 'Обрабатывает очередь AI-автоматизаций по входящим сообщениям.'
    worker_name = 'AI automation worker'

    def process_batch(self, limit):
        return process_pending_automation_events(limit=limit)

    def format_result(self, result):
        return (
            f"Обработано: {result['processed']}; "
            f"готово: {result['completed']}; "
            f"ошибок: {result['failed']}; "
            f"пропущено: {result['ignored']}; "
            f"перенесено: {result['rescheduled']}."
        )
