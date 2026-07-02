import requests
from django.conf import settings


class TelegramApiError(Exception):
    pass


class TelegramInvalidToken(TelegramApiError):
    pass


class TelegramApiUnavailable(TelegramApiError):
    pass


class TelegramWebhookRejected(TelegramApiError):
    pass


class TelegramBotApiClient:
    def __init__(self, session=None):
        self.session = session or requests.Session()

    def _call(self, token, method, *, data=None):
        url = f'{settings.TELEGRAM_API_BASE_URL}/bot{token}/{method}'
        try:
            response = self.session.post(
                url,
                json=data,
                timeout=settings.TELEGRAM_REQUEST_TIMEOUT,
            )
            payload = response.json()
        except (requests.RequestException, ValueError):
            raise TelegramApiUnavailable(
                'Telegram Bot API временно недоступен.',
            ) from None

        if payload.get('ok') is True:
            return payload.get('result')
        if response.status_code in (401, 404):
            raise TelegramInvalidToken('Telegram отклонил токен бота.')
        if response.status_code == 400 and method in ('getMe', 'getWebhookInfo'):
            raise TelegramInvalidToken('Telegram отклонил токен бота.')
        if response.status_code == 400:
            raise TelegramWebhookRejected(
                'Telegram отклонил настройки webhook.',
            )
        raise TelegramApiUnavailable('Telegram Bot API временно недоступен.')

    def get_me(self, token):
        result = self._call(token, 'getMe')
        if not isinstance(result, dict) or not result.get('is_bot'):
            raise TelegramInvalidToken('Токен не принадлежит Telegram-боту.')
        return result

    def get_webhook_info(self, token):
        result = self._call(token, 'getWebhookInfo')
        if not isinstance(result, dict):
            raise TelegramApiUnavailable(
                'Telegram вернул некорректный статус webhook.',
            )
        return result

    def set_webhook(self, token, *, url, secret_token):
        result = self._call(
            token,
            'setWebhook',
            data={
                'url': url,
                'secret_token': secret_token,
                'allowed_updates': ['message', 'edited_message'],
            },
        )
        if result is not True:
            raise TelegramWebhookRejected(
                'Telegram не подтвердил установку webhook.',
            )

    def delete_webhook(self, token):
        result = self._call(
            token,
            'deleteWebhook',
            data={'drop_pending_updates': False},
        )
        if result is not True:
            raise TelegramWebhookRejected(
                'Telegram не подтвердил удаление webhook.',
            )
