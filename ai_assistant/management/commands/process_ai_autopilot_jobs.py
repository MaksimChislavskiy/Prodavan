from ai_assistant.autopilot import process_pending_autopilot_jobs
from config.worker import QueueWorkerCommand


class Command(QueueWorkerCommand):
    help = 'Обрабатывает очередь ответов AI-автопилота.'
    worker_name = 'AI autopilot worker'

    def process_batch(self, limit):
        return process_pending_autopilot_jobs(limit=limit)

    def format_result(self, result):
        return (
            f"Обработано: {result['processed']}; "
            f"отправлено: {result['sent']}; "
            f"пропущено: {result['skipped']}; "
            f"ошибок: {result['failed']}; "
            f"перенесено: {result['rescheduled']}."
        )
