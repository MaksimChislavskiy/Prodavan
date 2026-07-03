from math import isfinite

import requests
from django.conf import settings


class EmbeddingConfigurationError(Exception):
    pass


class EmbeddingServiceError(Exception):
    pass


class EmbeddingClient:
    def __init__(
        self,
        *,
        base_url=None,
        api_key=None,
        model=None,
        timeout=None,
    ):
        self.base_url = (
            settings.AI_EMBEDDINGS_BASE_URL
            if base_url is None
            else base_url
        ).rstrip('/')
        self.api_key = (
            settings.AI_EMBEDDINGS_API_KEY
            if api_key is None
            else api_key
        )
        self.model = (
            settings.AI_EMBEDDINGS_MODEL
            if model is None
            else model
        )
        self.timeout = timeout or settings.AI_EMBEDDINGS_TIMEOUT

    def create_embeddings(self, texts):
        if not self.base_url or not self.model:
            raise EmbeddingConfigurationError
        if not texts:
            return []

        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
        try:
            response = requests.post(
                f'{self.base_url}/embeddings',
                headers=headers,
                json={'model': self.model, 'input': texts},
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as error:
            raise EmbeddingServiceError from error

        data = payload.get('data') if isinstance(payload, dict) else None
        if not isinstance(data, list) or len(data) != len(texts):
            raise EmbeddingServiceError
        if all(isinstance(item, dict) and 'index' in item for item in data):
            data = sorted(data, key=lambda item: item['index'])

        vectors = []
        expected_dimension = None
        for item in data:
            vector = item.get('embedding') if isinstance(item, dict) else None
            if not isinstance(vector, list) or not vector:
                raise EmbeddingServiceError
            try:
                vector = [float(value) for value in vector]
            except (TypeError, ValueError) as error:
                raise EmbeddingServiceError from error
            if not all(isfinite(value) for value in vector):
                raise EmbeddingServiceError
            if expected_dimension is None:
                expected_dimension = len(vector)
            elif len(vector) != expected_dimension:
                raise EmbeddingServiceError
            vectors.append(vector)
        return vectors
