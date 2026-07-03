from django.core.management.base import BaseCommand

from ai_assistant.processing import process_pending_knowledge_documents


class Command(BaseCommand):
    help = 'Обрабатывает очередь документов базы знаний AI.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=20)

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 100:
            raise ValueError('--limit должен быть от 1 до 100.')
        result = process_pending_knowledge_documents(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(
                f"Обработано: {result['processed']}; "
                f"готово: {result['ready']}; ошибок: {result['failed']}.",
            ),
        )
