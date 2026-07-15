# Prodavan

## Фоновые AI-обработчики

Для штатной работы AI-автоматизаций запустите два отдельных процесса под
управлением supervisor/systemd или аналогичного менеджера процессов:

```powershell
python manage.py process_ai_automation_events --watch --limit 1000 --poll-interval 1
python manage.py process_ai_autopilot_jobs --watch --limit 1000 --poll-interval 1
```

В режиме `--watch` заполненная очередь обрабатывается следующими пакетами без
ожидания, а пустая опрашивается с указанным интервалом. Интервал ограничен
диапазоном 0.1–5 секунд согласно NFR. Без `--watch` каждая команда выполняет
один проход, что удобно для ручной диагностики и внешнего планировщика.

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
