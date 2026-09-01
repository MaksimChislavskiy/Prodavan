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


class TelegramMessageRejected(TelegramApiError):
    pass


class TelegramBotApiClient:
    def __init__(self, session=None):
        self.session = session or requests.Session()

    def _call(self, token, method, *, data=None, files=None):
        url = f'{settings.TELEGRAM_API_BASE_URL}/bot{token}/{method}'
        try:
            request_kwargs = {
                'timeout': settings.TELEGRAM_REQUEST_TIMEOUT,
            }
            if files:
                request_kwargs['data'] = data
                request_kwargs['files'] = files
            else:
                request_kwargs['json'] = data
            response = self.session.post(url, **request_kwargs)
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
        if response.status_code in (400, 403) and method in {
            'sendMessage',
            'sendPhoto',
            'sendDocument',
        }:
            raise TelegramMessageRejected(
                'Telegram отклонил сообщение.',
            )
        if response.status_code == 400:
            raise TelegramWebhookRejected(
                'Telegram отклонил настройки webhook.',
            )
        raise TelegramApiUnavailable('Telegram Bot API временно недоступен.')

    @staticmethod
    def _validate_message_result(result, method):
        if not isinstance(result, dict) or not isinstance(
            result.get('message_id'),
            int,
        ):
            raise TelegramApiUnavailable(
                f'Telegram вернул некорректный ответ на {method}.',
            )
        return result

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

    def send_message(self, token, *, chat_id, text):
        result = self._call(
            token,
            'sendMessage',
            data={'chat_id': chat_id, 'text': text},
        )
        return self._validate_message_result(result, 'sendMessage')

    def _send_file(
        self,
        token,
        *,
        method,
        field,
        chat_id,
        file_obj,
        filename,
        content_type,
        caption=None,
    ):
        data = {'chat_id': chat_id}
        if caption:
            data['caption'] = caption
        result = self._call(
            token,
            method,
            data=data,
            files={
                field: (
                    filename,
                    file_obj,
                    content_type or 'application/octet-stream',
                ),
            },
        )
        return self._validate_message_result(result, method)

    def send_photo(
        self,
        token,
        *,
        chat_id,
        file_obj,
        filename,
        content_type,
        caption=None,
    ):
        return self._send_file(
            token,
            method='sendPhoto',
            field='photo',
            chat_id=chat_id,
            file_obj=file_obj,
            filename=filename,
            content_type=content_type,
            caption=caption,
        )

    def send_document(
        self,
        token,
        *,
        chat_id,
        file_obj,
        filename,
        content_type,
        caption=None,
    ):
        return self._send_file(
            token,
            method='sendDocument',
            field='document',
            chat_id=chat_id,
            file_obj=file_obj,
            filename=filename,
            content_type=content_type,
            caption=caption,
        )
