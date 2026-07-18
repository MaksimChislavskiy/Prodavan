# Аудит backend по ТЗ «Продаван»

Дата сверки: 2026-07-15. Источник: `E:\Dev\ТЗ Продаван.docx`.

Область аудита — только backend: модели и миграции, REST/WebSocket-контракты,
права доступа, фоновые процессы, аудит, безопасность и production-настройки.
UI/UX-требования и раздел 18 «Продающий сайт» исключены.

## Покрытие разделов

| Раздел ТЗ | Backend-состояние | Комментарий |
|---|---|---|
| 0. Аутентификация | Реализовано | Регистрация, подтверждение, вход, refresh/logout/me, восстановление пароля, профиль и отзыв сессий покрыты тестами. Добавлена пакетная ежедневная очистка истёкших registration/reset/refresh записей и освободившихся e-mail-резерваций. |
| 1. Общая концепция | Реализовано архитектурно | Изоляция по workspace и роли admin/user применяется в доменных API. Самостоятельного endpoint раздел не требует. |
| 2. Верхняя панель | Backend-зависимости реализованы частично | AI-чат, профиль и REST уведомлений доступны. Отдельный маршрут `/ws/notifications` отсутствует; события пока идут через `/ws/chat`. |
| 3. Раздел AI | Реализовано | Настройки AI, optimistic locking, аудит, база знаний, retry/delete и usage limits реализованы. Зависшие более 30 минут документы атомарно переводятся в `failed` с причиной `Processing timeout`; запоздавший worker не может перезаписать результат. |
| 4. Онбординг | Реализовано | Добавлены состояние workspace, два API, audit trail, admin permissions, idempotency, необратимый `completed` и событие `onboarding_status_updated` при изменении шагов. |
| 5. Рабочий стол | Реализовано | `/api/tasks/dashboard`, правила дат/часового пояса, сортировка, лимит 10 и workspace isolation покрыты задачами. |
| 6. Сделки | Реализовано | Kanban, cursor pagination, stages, idempotency, optimistic locking, soft delete, history и realtime-события присутствуют. |
| 7. Карточка сделки | Реализовано | Detail/create/update, связь с контактом, валидация и version conflict присутствуют. |
| 8. Контакты | Реализовано | Список, сортировка, поиск, find-by-name, bulk delete, нормализация, audit и workspace isolation присутствуют. |
| 9. Карточка контакта | Реализовано | Create/detail/patch, nullable-поля и optimistic locking присутствуют. |
| 10. Задачи | Реализовано | Kanban/list/dashboard, CRUD, отдельный status endpoint, bulk delete, history и idempotency присутствуют. |
| 11. Настройки | Реализовано | Workspace settings, company validation, ETag/version, idempotency, masked audit и Telegram metadata присутствуют. |
| 12. Чат | Реализовано | Chat/messages/read/delete/settings, idempotent outgoing delivery, Telegram ingestion и `/ws/chat` присутствуют. |
| 13. Профиль | Реализовано | Profile/version, avatar variants, password change, soft delete и audit присутствуют. |
| 14. Уведомления | REST реализован; WebSocket частично | List/count/read/mark-all/delete и генераторы уведомлений присутствуют. Нужен совместимый `/ws/notifications`. |
| 15. AI-чат | Реализовано | Sessions/history/message/retry/close, RAG, лимиты и статусы ошибок присутствуют. Неактивные сессии пакетно закрываются плановой командой; история не удаляется и сохраняется минимум 12 месяцев. Интервал вынесен в настройку, поскольку ТЗ не задаёт числовое значение. |
| 16. Telegram | Реализовано | Connect/disconnect/status, encrypted token, secret webhook, deduplication, health checks и logs присутствуют. |
| 17. AI-автоматизации | Реализовано | Очереди automation/autopilot, контакты/сделки/задачи/insights, лимиты, защита от повторов и audit API присутствуют. |
| 18. Продающий сайт | Вне области | Frontend не реализуется и не изменяется. |

## Очередь недостающих backend-этапов

1. Добавить отдельный WebSocket route `/ws/notifications` с тем же безопасным
   JWT-handshake и пользовательской группой уведомлений.
2. Удалить или изолировать неиспользуемые старые Django-заготовки `projects`,
   `analytics`, `tariffs`, которые не входят в `INSTALLED_APPS` и содержат
   незавершённые модели.

После каждого этапа документ обновляется, запускаются целевые тесты и полный
backend regression suite.
