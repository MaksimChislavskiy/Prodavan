import hashlib
import re
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import PurePath

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from messaging.realtime import broadcast_workspace_event
from workspaces.models import Workspace
from workspaces.onboarding import onboarding_knowledge_state_changed

from .models import AIAuditAction, AIAuditLog, KnowledgeChunk, KnowledgeDocument, KnowledgeDocumentStatus

MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_FILES_PER_UPLOAD = 20
MAX_FILES_PER_WORKSPACE = 1000
MAX_WORKSPACE_STORAGE = 5 * 1024 * 1024 * 1024
MAX_DOCX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024
ALLOWED_FILE_NAME = re.compile(r'[A-Za-zА-Яа-яЁё0-9 ._-]+')
SUPPORTED_FORMATS = {
    '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.csv': 'text/csv',
}

class KnowledgeServiceError(Exception):
    def __init__(self, code, message, *, status_code=400, extra=None):
        super().__init__(message); self.code = code; self.message = message
        self.status_code = status_code; self.extra = extra or {}
    @property
    def response_data(self):
        data = {'error': {'code': self.code, 'message': self.message}}; data.update(self.extra); return data

@dataclass
class PreparedUpload:
    uploaded_file: object
    original_name: str
    size_bytes: int
    mime_type: str
    sha256: str

def _audit_kwargs(audit_context):
    audit_context = audit_context or {}
    return {'ip': audit_context.get('ip_address'), 'user_agent': (audit_context.get('user_agent') or '')[:512]}

def _onboarding_correlation_id(audit_context):
    audit_context = audit_context or {}
    return str(audit_context.get('correlation_id') or '')[:64]

def _audit_request_id(audit_context):
    audit_context = audit_context or {}
    return audit_context.get('correlation_id') or uuid.uuid4()

def _normalized_name(uploaded_file):
    raw_name = str(getattr(uploaded_file, 'name', '') or '')
    return PurePath(raw_name.replace('\\', '/')).name

def _hash_and_measure(uploaded_file):
    digest = hashlib.sha256(); size = 0
    for chunk in uploaded_file.chunks():
        size += len(chunk)
        if size > MAX_FILE_SIZE:
            raise KnowledgeServiceError('FILE_TOO_LARGE', 'Размер файла не должен превышать 20 МБ.', status_code=413)
        digest.update(chunk)
    uploaded_file.seek(0); return digest.hexdigest(), size

def _validate_text_sample(uploaded_file):
    sample = uploaded_file.read(64 * 1024); uploaded_file.seek(0)
    if b'\x00' in sample: return False
    for encoding in ('utf-8-sig', 'cp1251'):
        try:
            text = sample.decode(encoding); break
        except UnicodeDecodeError: continue
    else: return False
    if not text: return True
    controls = sum(1 for character in text if ord(character) < 32 and character not in '\r\n\t')
    return controls / len(text) < 0.01

def _validate_docx_container(uploaded_file):
    try:
        with zipfile.ZipFile(uploaded_file) as archive:
            names = set(archive.namelist())
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names: return False
            if sum(item.file_size for item in archive.infolist()) > MAX_DOCX_UNCOMPRESSED_SIZE: return False
    except (OSError, zipfile.BadZipFile): return False
    finally: uploaded_file.seek(0)
    return True

def _validate_content(uploaded_file, extension):
    if extension == '.pdf':
        header = uploaded_file.read(5); uploaded_file.seek(0); return header == b'%PDF-'
    if extension == '.docx': return _validate_docx_container(uploaded_file)
    return _validate_text_sample(uploaded_file)

def prepare_upload(uploaded_file):
    name = _normalized_name(uploaded_file)
    if not name or len(name) > 255: raise KnowledgeServiceError('INVALID_FILE_NAME', 'Имя файла не должно превышать 255 символов.')
    if not ALLOWED_FILE_NAME.fullmatch(name): raise KnowledgeServiceError('INVALID_FILE_NAME', 'Имя файла содержит недопустимые символы.')
    extension = PurePath(name).suffix.lower()
    if extension not in SUPPORTED_FORMATS: raise KnowledgeServiceError('UNSUPPORTED_FILE_TYPE', 'Поддерживаются только PDF, TXT, DOCX, CSV.')
    sha256, size = _hash_and_measure(uploaded_file)
    if size == 0: raise KnowledgeServiceError('EMPTY_FILE', 'Файл не должен быть пустым.')
    if not _validate_content(uploaded_file, extension): raise KnowledgeServiceError('INVALID_FILE_CONTENT', 'Формат файла не соответствует его содержимому или файл повреждён.')
    return PreparedUpload(uploaded_file=uploaded_file, original_name=name, size_bytes=size, mime_type=SUPPORTED_FORMATS[extension], sha256=sha256)

def active_documents(workspace):
    return KnowledgeDocument.objects.filter(workspace=workspace, is_deleted=False)

def storage_usage(workspace):
    aggregate = active_documents(workspace).aggregate(files_count=Count('id'), used_bytes=Sum('size_bytes'))
    return {'files_count': aggregate['files_count'] or 0, 'files_limit': MAX_FILES_PER_WORKSPACE, 'used_bytes': aggregate['used_bytes'] or 0, 'limit_bytes': MAX_WORKSPACE_STORAGE}

def _document_event(document):
    return {'id': str(document.id), 'name': document.original_name, 'status': document.status, 'error_reason': document.error_reason, 'processed_at': document.processed_at.isoformat() if document.processed_at else None}

def broadcast_document_status(document, event='knowledge_document_status'):
    payload = {'event': event, 'document': _document_event(document)}
    transaction.on_commit(lambda: broadcast_workspace_event(document.workspace_id, payload))

def create_knowledge_documents(*, workspace, user, uploaded_files, audit_context=None):
    if not uploaded_files: raise KnowledgeServiceError('FILES_REQUIRED', 'Добавьте хотя бы один файл.')
    if len(uploaded_files) > MAX_FILES_PER_UPLOAD: raise KnowledgeServiceError('TOO_MANY_FILES', 'Можно загружать не более 20 файлов одновременно.')
    prepared = [prepare_upload(uploaded_file) for uploaded_file in uploaded_files]
    batch_size = sum(item.size_bytes for item in prepared); saved_names = []
    audit_kwargs = _audit_kwargs(audit_context); onboarding_correlation_id = _onboarding_correlation_id(audit_context)
    try:
        with transaction.atomic():
            locked_workspace = Workspace.objects.select_for_update().get(pk=workspace.pk)
            usage = storage_usage(locked_workspace)
            if usage['files_count'] + len(prepared) > MAX_FILES_PER_WORKSPACE: raise KnowledgeServiceError('FILE_COUNT_LIMIT', 'Достигнут лимит количества файлов (1000). Удалите ненужные.')
            if usage['used_bytes'] + batch_size > MAX_WORKSPACE_STORAGE: raise KnowledgeServiceError('STORAGE_LIMIT', 'Превышен общий лимит хранения (5 ГБ). Удалите часть файлов.')
            request_id = _audit_request_id(audit_context)
            documents = []; audit_logs = []
            for item in prepared:
                document = KnowledgeDocument(workspace=locked_workspace, uploaded_by=user, uploaded_by_identifier=user.id, original_name=item.original_name, size_bytes=item.size_bytes, mime_type=item.mime_type, sha256=item.sha256, onboarding_correlation_id=onboarding_correlation_id)
                document.file.save(item.original_name, item.uploaded_file, save=False); saved_names.append(document.file.name); document.save(); documents.append(document)
                audit_logs.append(AIAuditLog(workspace=locked_workspace, user=user, user_identifier=user.id, action=AIAuditAction.DOCUMENT_UPLOADED, changes={'document_id': str(document.id), 'name': document.original_name, 'size_bytes': document.size_bytes}, request_id=request_id, **audit_kwargs))
            AIAuditLog.objects.bulk_create(audit_logs)
            for document in documents: broadcast_document_status(document, event='knowledge_document_created')
    except Exception:
        for name in saved_names: default_storage.delete(name)
        raise
    return documents

def get_active_document(*, workspace, document_id, for_update=False):
    queryset = active_documents(workspace)
    if for_update: queryset = queryset.select_for_update()
    return queryset.filter(id=document_id).first()

def retry_knowledge_document(*, workspace, user, document_id, audit_context=None):
    with transaction.atomic():
        document = get_active_document(workspace=workspace, document_id=document_id, for_update=True)
        if document is None: raise KnowledgeServiceError('DOCUMENT_NOT_FOUND', 'Документ не найден.', status_code=404)
        if document.status != KnowledgeDocumentStatus.FAILED: raise KnowledgeServiceError('DOCUMENT_NOT_FAILED', 'Повторная обработка доступна только для документов с ошибкой.', status_code=409)
        old_error = document.error_reason
        document.status = KnowledgeDocumentStatus.PROCESSING; document.error_reason = ''; document.processing_started_at = None; document.processed_at = None
        document.onboarding_correlation_id = _onboarding_correlation_id(audit_context)
        document.save(update_fields=('status', 'error_reason', 'processing_started_at', 'processed_at', 'onboarding_correlation_id', 'updated_at'))
        KnowledgeChunk.objects.filter(document=document).delete()
        AIAuditLog.objects.create(workspace=workspace, user=user, user_identifier=user.id, action=AIAuditAction.DOCUMENT_RETRY, changes={'document_id': str(document.id), 'previous_error': old_error}, request_id=_audit_request_id(audit_context), **_audit_kwargs(audit_context))
        broadcast_document_status(document)
    return document

def delete_knowledge_document(*, workspace, user, document_id, audit_context=None):
    with transaction.atomic():
        document = get_active_document(workspace=workspace, document_id=document_id, for_update=True)
        if document is None: raise KnowledgeServiceError('DOCUMENT_NOT_FOUND', 'Документ не найден.', status_code=404)
        file_name = document.file.name; was_ready = document.status == KnowledgeDocumentStatus.READY; has_other_ready = False
        if was_ready: has_other_ready = active_documents(workspace).filter(status=KnowledgeDocumentStatus.READY).exclude(id=document.id).exists()
        document.is_deleted = True; document.deleted_at = timezone.now(); document.save(update_fields=('is_deleted', 'deleted_at', 'updated_at'))
        KnowledgeChunk.objects.filter(document=document).delete()
        AIAuditLog.objects.create(workspace=workspace, user=user, user_identifier=user.id, action=AIAuditAction.DOCUMENT_DELETED, changes={'document_id': str(document.id), 'name': document.original_name}, request_id=_audit_request_id(audit_context), **_audit_kwargs(audit_context))
        broadcast_document_status(document, event='knowledge_document_deleted')
        if was_ready and not has_other_ready:
            transaction.on_commit(lambda: onboarding_knowledge_state_changed(workspace_id=workspace.id, previous_has_ready=True, current_has_ready=False, user_id=user.id, correlation_id=_onboarding_correlation_id(audit_context) or None, trigger_document_id=document.id), robust=True)
        transaction.on_commit(lambda: default_storage.delete(file_name), robust=True)
