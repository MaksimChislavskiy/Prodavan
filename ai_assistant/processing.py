import csv
import io
import re
import unicodedata
import zipfile
from datetime import timedelta
from xml.etree import ElementTree

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .embeddings import (
    EmbeddingClient,
    EmbeddingConfigurationError,
    EmbeddingServiceError,
)
from .knowledge import broadcast_document_status
from .models import KnowledgeChunk, KnowledgeDocument, KnowledgeDocumentStatus


CHUNK_TOKENS = 750
CHUNK_OVERLAP = 100
MAX_EXTRACTED_CHARACTERS = 10_000_000
MAX_CHUNKS = 10_000
PROCESSING_LOCK_TIMEOUT = timedelta(minutes=10)


class DocumentProcessingError(Exception):
    pass


def _decode_text(data):
    for encoding in ('utf-8-sig', 'cp1251'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DocumentProcessingError('Неподдерживаемая кодировка файла.')


def _extract_pdf(file_object):
    try:
        reader = PdfReader(file_object, strict=False)
        if reader.is_encrypted and not reader.decrypt(''):
            raise DocumentProcessingError('PDF защищён паролем.')
        parts = []
        characters = 0
        for page in reader.pages:
            page_text = page.extract_text() or ''
            characters += len(page_text)
            if characters > MAX_EXTRACTED_CHARACTERS:
                raise DocumentProcessingError('Извлечённый текст слишком большой.')
            parts.append(page_text)
        return '\n\n'.join(parts)
    except DocumentProcessingError:
        raise
    except (PdfReadError, OSError, ValueError) as error:
        raise DocumentProcessingError('Файл PDF повреждён.') from error


def _extract_docx(file_object):
    try:
        with zipfile.ZipFile(file_object) as archive:
            xml = archive.read('word/document.xml')
    except (KeyError, OSError, zipfile.BadZipFile) as error:
        raise DocumentProcessingError('Файл DOCX повреждён.') from error
    if len(xml) > MAX_EXTRACTED_CHARACTERS * 5:
        raise DocumentProcessingError('Документ слишком большой.')
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise DocumentProcessingError('Файл DOCX повреждён.') from error
    namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    paragraphs = []
    for paragraph in root.iter(f'{namespace}p'):
        text = ''.join(
            node.text or '' for node in paragraph.iter(f'{namespace}t')
        ).strip()
        if text:
            paragraphs.append(text)
    return '\n\n'.join(paragraphs)


def _extract_csv(file_object):
    text = _decode_text(file_object.read())
    csv.field_size_limit(1_000_000)
    try:
        rows = csv.reader(io.StringIO(text, newline=''))
        return '\n'.join(
            ' | '.join(cell.strip() for cell in row)
            for row in rows
            if any(cell.strip() for cell in row)
        )
    except csv.Error as error:
        raise DocumentProcessingError('Файл CSV повреждён.') from error


def extract_document_text(document):
    extension = document.original_name.rsplit('.', 1)[-1].lower()
    try:
        with document.file.open('rb') as file_object:
            if extension == 'pdf':
                return _extract_pdf(file_object)
            if extension == 'docx':
                return _extract_docx(file_object)
            if extension == 'csv':
                return _extract_csv(file_object)
            if extension == 'txt':
                return _decode_text(file_object.read())
    except FileNotFoundError as error:
        raise DocumentProcessingError('Файл отсутствует в хранилище.') from error
    raise DocumentProcessingError('Неподдерживаемый формат файла.')


def clean_text(text):
    text = unicodedata.normalize('NFKC', text).replace('\x00', '')
    lines = []
    for line in text.splitlines():
        line = re.sub(r'[ \t]+', ' ', line).strip()
        if line or (lines and lines[-1]):
            lines.append(line)
    cleaned = '\n'.join(lines).strip()
    if not cleaned:
        raise DocumentProcessingError('Не удалось извлечь текст из документа.')
    if len(cleaned) > MAX_EXTRACTED_CHARACTERS:
        raise DocumentProcessingError('Извлечённый текст слишком большой.')
    return cleaned


def split_into_chunks(text):
    tokens = re.findall(r'\S+', text)
    if not tokens:
        raise DocumentProcessingError('Не удалось извлечь текст из документа.')
    chunks = []
    start = 0
    while start < len(tokens):
        chunk_tokens = tokens[start:start + CHUNK_TOKENS]
        chunks.append((' '.join(chunk_tokens), len(chunk_tokens)))
        if len(chunks) > MAX_CHUNKS:
            raise DocumentProcessingError('Документ содержит слишком много текста.')
        if start + CHUNK_TOKENS >= len(tokens):
            break
        start += CHUNK_TOKENS - CHUNK_OVERLAP
    return chunks


def _claim_document(document_id):
    stale_before = timezone.now() - PROCESSING_LOCK_TIMEOUT
    with transaction.atomic():
        document = (
            KnowledgeDocument.objects.select_for_update()
            .select_related('workspace')
            .filter(id=document_id, is_deleted=False)
            .first()
        )
        if document is None or document.status != KnowledgeDocumentStatus.PROCESSING:
            return None
        if (
            document.processing_started_at is not None
            and document.processing_started_at > stale_before
        ):
            return None
        document.processing_started_at = timezone.now()
        document.processing_attempts += 1
        document.error_reason = ''
        document.save(
            update_fields=(
                'processing_started_at',
                'processing_attempts',
                'error_reason',
                'updated_at',
            ),
        )
    return document


def _embed_chunks(chunks, client):
    batch_size = settings.AI_EMBEDDINGS_BATCH_SIZE
    if not 1 <= batch_size <= 256:
        raise EmbeddingConfigurationError
    vectors = []
    expected_dimension = None
    for offset in range(0, len(chunks), batch_size):
        batch = [text for text, _ in chunks[offset:offset + batch_size]]
        batch_vectors = client.create_embeddings(batch)
        for vector in batch_vectors:
            if expected_dimension is None:
                expected_dimension = len(vector)
            elif len(vector) != expected_dimension:
                raise EmbeddingServiceError
        vectors.extend(batch_vectors)
    if len(vectors) != len(chunks):
        raise EmbeddingServiceError
    return vectors


def _mark_failed(document_id, message):
    with transaction.atomic():
        document = (
            KnowledgeDocument.objects.select_for_update()
            .filter(id=document_id, is_deleted=False)
            .first()
        )
        if document is None:
            return
        document.status = KnowledgeDocumentStatus.FAILED
        document.error_reason = message[:1000]
        document.processing_started_at = None
        document.processed_at = timezone.now()
        document.save(
            update_fields=(
                'status',
                'error_reason',
                'processing_started_at',
                'processed_at',
                'updated_at',
            ),
        )
        broadcast_document_status(document)


def process_knowledge_document(document_id, *, embedding_client=None):
    document = _claim_document(document_id)
    if document is None:
        return None
    client = embedding_client or EmbeddingClient()
    try:
        text = clean_text(extract_document_text(document))
        chunks = split_into_chunks(text)
        vectors = _embed_chunks(chunks, client)
        with transaction.atomic():
            locked = (
                KnowledgeDocument.objects.select_for_update()
                .filter(id=document.id, is_deleted=False)
                .first()
            )
            if locked is None:
                return None
            KnowledgeChunk.objects.filter(document=locked).delete()
            KnowledgeChunk.objects.bulk_create(
                [
                    KnowledgeChunk(
                        document=locked,
                        workspace_id=locked.workspace_id,
                        position=position,
                        text=chunk_text,
                        token_count=token_count,
                        embedding=vector,
                    )
                    for position, ((chunk_text, token_count), vector) in enumerate(
                        zip(chunks, vectors),
                    )
                ],
            )
            locked.status = KnowledgeDocumentStatus.READY
            locked.error_reason = ''
            locked.processing_started_at = None
            locked.processed_at = timezone.now()
            locked.save(
                update_fields=(
                    'status',
                    'error_reason',
                    'processing_started_at',
                    'processed_at',
                    'updated_at',
                ),
            )
            broadcast_document_status(locked)
        return KnowledgeDocumentStatus.READY
    except EmbeddingConfigurationError:
        message = 'Сервис эмбеддингов не настроен.'
    except EmbeddingServiceError:
        message = 'Сервис эмбеддингов временно недоступен.'
    except DocumentProcessingError as error:
        message = str(error)
    except Exception:
        message = 'Не удалось обработать документ.'
    _mark_failed(document.id, message)
    return KnowledgeDocumentStatus.FAILED


def process_pending_knowledge_documents(*, limit=20, embedding_client=None):
    stale_before = timezone.now() - PROCESSING_LOCK_TIMEOUT
    document_ids = list(
        KnowledgeDocument.objects.filter(
            status=KnowledgeDocumentStatus.PROCESSING,
            is_deleted=False,
        )
        .filter(
            Q(processing_started_at__isnull=True)
            | Q(processing_started_at__lte=stale_before),
        )
        .order_by('created_at', 'id')
        .values_list('id', flat=True)[:limit],
    )
    result = {'processed': 0, 'ready': 0, 'failed': 0}
    for document_id in document_ids:
        status = process_knowledge_document(
            document_id,
            embedding_client=embedding_client,
        )
        if status is None:
            continue
        result['processed'] += 1
        result[status] += 1
    return result
