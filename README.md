# Prodavan

## Онбординг workspace

Backend онбординга доступен только администратору текущего workspace:

- `GET /api/user/onboarding-status` — актуальный статус и два шага;
- `POST /api/user/onboarding/materials-viewed` — идемпотентная отметка материалов.

Шаг базы знаний вычисляется по наличию хотя бы одного активного документа в
статусе `ready`. После выполнения обоих шагов `completed` фиксируется
транзакционно и больше не откатывается, даже если документы позднее удалены.
Изменения отправляются событием `onboarding_status_updated` через workspace
WebSocket-группу. Ключевые действия сохраняются в отдельном audit trail с
correlation ID.

## Фоновые обработчики

Для штатной работы очередей запустите шесть отдельных процессов под
управлением supervisor/systemd или аналогичного менеджера процессов:

```powershell
python manage.py process_telegram_webhooks --watch --limit 1000 --poll-interval 1
python manage.py process_outgoing_messages --watch --limit 1000 --poll-interval 1
python manage.py process_ai_automation_events --watch --limit 1000 --poll-interval 1
python manage.py process_ai_autopilot_jobs --watch --limit 1000 --poll-interval 1
python manage.py process_knowledge_documents --watch --limit 100 --poll-interval 1
python manage.py process_auth_emails --watch --limit 100 --poll-interval 1
```

Knowledge worker переводит документ, который находится в активной обработке
более 30 минут, в статус `failed` с причиной `Processing timeout`. Такой
документ не захватывается повторно автоматически: администратор может явно
запустить retry через API базы знаний.

Auth email worker повторяет неудачную отправку писем регистрации и
восстановления пароля до трёх раз с SMTP timeout 10 секунд. Содержимое очереди,
включая одноразовый код, хранится в БД только в зашифрованном виде.

В режиме `--watch` заполненная очередь обрабатывается следующими пакетами без
ожидания, а неполная опрашивается с указанным интервалом. Интервал ограничен
диапазоном 0.1–5 секунд согласно NFR. Без `--watch` каждая команда выполняет
один проход, что удобно для ручной диагностики и внешнего планировщика.
SIGINT/SIGTERM завершают worker после текущего пакета. Необработанное исключение
завершает процесс с ошибкой, поэтому менеджер процессов должен его перезапускать.

Периодические проверки дедлайнов, пропущенных сообщений, сделок и Telegram-
интеграций остаются одноразовыми командами. Запускайте их через cron/systemd
timer или планировщик платформы с требуемым интервалом:

```powershell
python manage.py check_task_deadlines
python manage.py check_missed_chat_messages
python manage.py check_deal_attention
python manage.py check_telegram_integrations
python manage.py cleanup_auth_records
python manage.py close_inactive_ai_chat_sessions
```

Две последние команды запускайте не реже одного раза в сутки. Первая удаляет
истёкшие/отозванные временные auth-записи, завершённые записи почтовой очереди,
освободившиеся e-mail-резервации и auth-аудит старше 366 дней.
Вторая закрывает AI-chat сессии после периода неактивности из
`AI_CHAT_SESSION_IDLE_MINUTES` (по умолчанию 30 минут), не удаляя историю:
согласно ТЗ она хранится не менее 12 месяцев.

## WebSocket-каналы

- `/ws/chat` подписывает авторизованного пользователя на события его workspace;
- `/ws/notifications` подписывает только на персональные события уведомлений.

Access token передавайте через `Sec-WebSocket-Protocol` как пару протоколов
`Bearer, <token>`; сервер подтверждает только `Bearer` и не возвращает токен.
Недействительный, истёкший или отозванный через `token_version` JWT закрывается
с кодом `1008`. Изменяющие команды через WebSocket не принимаются — для них
используется REST API.

## Production-безопасность

Перед развёртыванием создайте отдельный production `.env` и обязательно:

- установите `DJANGO_DEBUG=False`;
- укажите публичные домены в `DJANGO_ALLOWED_HOSTS`;
- включите HTTPS redirect и установите `DJANGO_SESSION_COOKIE_SECURE=True`,
  `DJANGO_CSRF_COOKIE_SECURE=True`, `AUTH_COOKIE_SECURE=True`;
- настройте HSTS постепенно, затем увеличьте срок до `31536000`;
- включайте `DJANGO_TRUST_PROXY_HEADERS` только за доверенным reverse proxy,
  который перезаписывает заголовок `X-Forwarded-Proto`.

Полный список параметров и безопасные комментарии находятся в `.env.example`.
Перед запуском production выполните:

```powershell
python manage.py check --deploy
python manage.py collectstatic --noinput
```

Команда `check --deploy` должна завершиться без предупреждений. Локальный
профиль с `DJANGO_DEBUG=True` намеренно не включает HTTPS redirect и HSTS.

## Health checks

Для балансировщика или оркестратора доступны публичные endpoints без
завершающего слеша:

- `GET /api/health/live` — процесс Django принимает HTTP-запросы;
- `GET /api/health/ready` — приложение готово к трафику и БД отвечает.

Readiness возвращает `503`, если БД недоступна. Ответы не кэшируются и не
содержат тексты внутренних исключений.

## Production database

Локально проект по умолчанию использует SQLite. Для production задайте в
`.env` `DATABASE_ENGINE=postgresql` и заполните `DATABASE_NAME`,
`DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_HOST`. Поддерживаются
`DATABASE_SSLMODE`, таймаут подключения и время жизни соединения; значения и
описания перечислены в `.env.example`.

После настройки PostgreSQL и перед запуском приложения выполните:

```powershell
python manage.py migrate --noinput
python manage.py check --deploy
```

## Логи и корреляция запросов

Каждый HTTP-ответ содержит `X-Request-ID`. Корректный идентификатор клиента
сохраняется, некорректный или слишком длинный заменяется UUID. Этот же ID
автоматически добавляется во все логи, созданные во время запроса.

Логи пишутся только в stdout. Для production установите `LOG_LEVEL=INFO` и
`LOG_FORMAT=json`; локально используются читаемые console-логи. Тела запросов,
пароли, токены и другие секреты инфраструктурный логгер не записывает.

## Redis

В production Redis обязателен для Channels, общих rate limits и cache между
workers. Обычно достаточно задать `REDIS_URL`; при необходимости используются
отдельные `CHANNEL_REDIS_URL` и `CACHE_REDIS_URL`. При `DEBUG=True` без URL
сохраняются локальные in-memory backend'ы для разработки и тестов.

Readiness проверяет запись и чтение cache. При недоступности Redis endpoint
возвращает `503`, не раскрывая адрес или реквизиты подключения.

## Хранилище файлов

Локально аватары и документы базы знаний сохраняются в `MEDIA_ROOT`. Для
production используется `MEDIA_STORAGE_BACKEND=s3` и приватный S3-compatible
bucket. Файлы не получают публичный ACL, ссылки подписываются и имеют срок
действия, а перезапись существующих объектов отключена.

Обязательны `S3_BUCKET_NAME` и `S3_REGION_NAME`. Ключи доступа можно не
указывать при использовании IAM role/task identity. Для стороннего S3 задайте
HTTPS `S3_ENDPOINT_URL`. Readiness проверяет доступность storage без записи
объектов и не раскрывает реквизиты подключения.

Локальный storage при `DEBUG=False` блокируется. Для развёртывания с общим
persistent volume его можно явно разрешить через
`ALLOW_LOCAL_MEDIA_IN_PRODUCTION=True`.

## Email

Локально письма выводятся console backend'ом. Для production настройте SMTP:
`EMAIL_BACKEND=smtp`, `DEFAULT_FROM_EMAIL`, `EMAIL_HOST` и порт. Соединение
обязано использовать `EMAIL_USE_TLS=True` либо `EMAIL_USE_SSL=True`; одновременно
эти режимы включать нельзя. `EMAIL_TIMEOUT` ограничивает зависание запроса при
недоступности почтового сервера и по ТЗ не может превышать 10 секунд.

Console/locmem backend при `DEBUG=False` блокируется. Исключение для специальной
staging-среды требует явного
`ALLOW_NON_DELIVERY_EMAIL_BACKEND_IN_PRODUCTION=True`.
