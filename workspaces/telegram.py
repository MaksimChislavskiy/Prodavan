import requests
from django.conf import settings


class TelegramApiError(Exception):
    pass


class TelegramInvalidToken(TelegramApiError):
    pass


class TelegramApiUnavailable(TelegramApiError):
    pass


class TelegramBotApiClient:
    def __init__(self, session=None):
        self.session = session or requests.Session()

    def _call(self, token, method):
        url = f'{settings.TELEGRAM_API_BASE_URL}/bot{token}/{method}'
        try:
            response = self.session.post(
                url,
                timeout=settings.TELEGRAM_REQUEST_TIMEOUT,
            )
            payload = response.json()
        except (requests.RequestException, ValueError):
            raise TelegramApiUnavailable(
                'Telegram Bot API временно недоступен.',
            ) from None

        if payload.get('ok') is True:
            return payload.get('result')
        if response.status_code in (400, 401, 404):
            raise TelegramInvalidToken('Telegram отклонил токен бота.')
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
