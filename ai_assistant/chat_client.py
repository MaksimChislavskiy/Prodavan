import html
import re
import time
from dataclasses import dataclass
from typing import Optional

import requests
from django.conf import settings


MAX_AI_RESPONSE_LENGTH = 20_000
ALLOWED_CRM_LINK = re.compile(
    r'^/(?:deals|contacts|tasks|chat|chats)/[A-Za-z0-9-]+$',
)


class ChatConfigurationError(Exception):
    pass


class ChatServiceError(Exception):
    pass


class ChatTimeoutError(ChatServiceError):
    pass


class EmptyChatResponseError(ChatServiceError):
    pass


@dataclass
class ChatCompletionResult:
    content: str
    model_name: str
    provider: str
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    total_tokens: Optional[int]
    processing_time_ms: int


def sanitize_ai_content(content):
    content = content.strip()
    content = re.sub(r'!\[([^]]*)\]\([^)]*\)', r'\1', content)

    def replace_link(match):
        label, target = match.group(1), match.group(2).strip()
        if ALLOWED_CRM_LINK.fullmatch(target):
            return f'[{label}]({target})'
        return label

    content = re.sub(r'\[([^]]+)\]\(([^)]+)\)', replace_link, content)
    content = re.sub(
        r'(?i)\b(?:https?://|javascript:)[^\s<>()]+',
        '[внешняя ссылка удалена]',
        content,
    )
    content = html.escape(content, quote=False)
    if len(content) > MAX_AI_RESPONSE_LENGTH:
        suffix = '... (ответ обрезан)'
        content = content[:MAX_AI_RESPONSE_LENGTH - len(suffix)] + suffix
    return content


class ChatCompletionClient:
    def __init__(
        self,
        *,
        base_url=None,
        api_key=None,
        model=None,
        provider=None,
        timeout=None,
        retry_attempts=None,
    ):
        self.base_url = (
            settings.AI_CHAT_BASE_URL if base_url is None else base_url
        ).rstrip('/')
        if api_key is None:
            self.api_key = settings.AI_CHAT_API_KEY if base_url is None else ''
        else:
            self.api_key = api_key
        self.model = settings.AI_CHAT_MODEL if model is None else model
        self.provider = (
            settings.AI_CHAT_PROVIDER if provider is None else provider
        )
        self.timeout = timeout or settings.AI_CHAT_TIMEOUT
        self.retry_attempts = retry_attempts or settings.AI_CHAT_RETRY_ATTEMPTS

    def complete(self, messages):
        if not self.base_url or not self.model:
            raise ChatConfigurationError
        if not 1 <= self.retry_attempts <= 3 or not 1 <= self.timeout <= 120:
            raise ChatConfigurationError
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        started = time.monotonic()
        response = None
        last_error = None
        for attempt in range(self.retry_attempts):
            try:
                response = requests.post(
                    f'{self.base_url}/chat/completions',
                    headers=headers,
                    json={
                        'model': self.model,
                        'messages': messages,
                        'temperature': 0.2,
                    },
                    timeout=max(1, self.timeout / self.retry_attempts),
                )
                if 400 <= response.status_code < 500:
                    raise ChatServiceError
                if response.status_code >= 500:
                    raise requests.HTTPError(response=response)
                response.raise_for_status()
                break
            except requests.Timeout as error:
                last_error = error
                if attempt + 1 == self.retry_attempts:
                    raise ChatTimeoutError from error
            except requests.RequestException as error:
                last_error = error
                if attempt + 1 == self.retry_attempts:
                    raise ChatServiceError from error
            time.sleep(min(0.25 * (2 ** attempt), 1.0))
        if response is None:
            raise ChatServiceError from last_error

        try:
            payload = response.json()
            content = payload['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ChatServiceError from error
        if not isinstance(content, str) or not content.strip():
            raise EmptyChatResponseError

        usage = payload.get('usage') or {}

        def optional_non_negative_int(name):
            value = usage.get(name)
            return value if isinstance(value, int) and value >= 0 else None

        return ChatCompletionResult(
            content=sanitize_ai_content(content),
            model_name=str(payload.get('model') or self.model)[:100],
            provider=str(self.provider)[:100],
            prompt_tokens=optional_non_negative_int('prompt_tokens'),
            completion_tokens=optional_non_negative_int('completion_tokens'),
            total_tokens=optional_non_negative_int('total_tokens'),
            processing_time_ms=max(0, int((time.monotonic() - started) * 1000)),
        )