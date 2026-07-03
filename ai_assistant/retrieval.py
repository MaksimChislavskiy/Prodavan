import heapq
import math
from dataclasses import dataclass

from django.conf import settings

from .embeddings import EmbeddingClient, EmbeddingServiceError
from .models import KnowledgeChunk, KnowledgeDocumentStatus


@dataclass
class RetrievedChunk:
    chunk_id: object
    document_id: object
    document_name: str
    position: int
    text: str
    score: float

    @property
    def source(self):
        return {
            'document_id': str(self.document_id),
            'document_name': self.document_name,
            'position': self.position,
            'score': round(self.score, 6),
        }


def cosine_similarity(left, right):
    if len(left) != len(right) or not left:
        raise ValueError
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def retrieve_knowledge(
    *,
    workspace,
    query,
    embedding_client=None,
    limit=None,
    min_score=None,
):
    limit = settings.AI_CHAT_RETRIEVAL_LIMIT if limit is None else limit
    min_score = settings.AI_RETRIEVAL_MIN_SCORE if min_score is None else min_score
    if not 1 <= limit <= 20 or not -1.0 <= min_score <= 1.0:
        raise EmbeddingServiceError

    queryset = (
        KnowledgeChunk.objects.filter(
            workspace=workspace,
            document__status=KnowledgeDocumentStatus.READY,
            document__is_deleted=False,
        )
        .select_related('document')
        .only(
            'id',
            'document_id',
            'document__original_name',
            'position',
            'text',
            'embedding',
        )
    )
    if not queryset.exists():
        return []
    client = embedding_client or EmbeddingClient()
    vectors = client.create_embeddings([query])
    if len(vectors) != 1:
        raise EmbeddingServiceError
    query_vector = vectors[0]

    best = []
    for chunk in queryset.iterator(chunk_size=500):
        try:
            vector = [float(value) for value in chunk.embedding]
            score = cosine_similarity(query_vector, vector)
        except (TypeError, ValueError, OverflowError):
            continue
        if score < min_score:
            continue
        item = (
            score,
            str(chunk.id),
            RetrievedChunk(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document_name=chunk.document.original_name,
                position=chunk.position,
                text=chunk.text,
                score=score,
            ),
        )
        if len(best) < limit:
            heapq.heappush(best, item)
        elif item[:2] > best[0][:2]:
            heapq.heapreplace(best, item)
    return [item[2] for item in sorted(best, reverse=True)]
