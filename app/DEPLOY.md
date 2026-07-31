# Deployment — Dokploy

## Build

- **Build context:** `app/` (this directory)
- **Dockerfile:** `app/Dockerfile`

Dokploy builds the image directly from the Git repo. Point the build context at `app/`.

## Environment variables

| Variable | Value |
|---|---|
| `FUNNELS_DB_PATH` | `/data/ksamata_funnels.db` |
| `NODE_ENV` | `production` (set in Dockerfile) |
| `ADMIN_USERS` | `имя:пароль`, через запятую или перевод строки — учётки редакторов |
| `ADMIN_SESSION_SECRET` | ключ подписи сессии, **обязателен в проде**, минимум 16 символов (`openssl rand -base64 32`) |
| `PUBLIC_READ_ENABLED` | `false` закрывает и чтение тоже — возврат к прежней модели без выката кода |
| `ADMIN_BASIC_AUTH` | совместимость: одиночная учётка на запись для curl и скриптов |
| `ADMIN_AUTH_DISABLED` | `true` выключает авторизацию целиком. ⚠️ админку сможет **править** любой. Убери переменную, чтобы вернуть вход. |

### Модель доступа

Список воронок и карточки читает кто угодно без входа. Справочники, шаблон
тегов, мониторинг, CSV-экспорт и любое изменение данных — только после входа
на `/login`. Сервис отдаёт `X-Robots-Tag: noindex, nofollow` и `robots.txt`
с `Disallow: /`, но это просьба к поисковикам, а не защита: **всё, что видно
на карточке воронки — URL лендов, ссылки GetCourse, комментарии — доступно
любому, кто знает адрес сервиса.**

Без `ADMIN_USERS` и `ADMIN_SESSION_SECRET` прод не падает целиком: чтение
работает, а любая запись отвечает 503 с именем недостающей переменной. Так
забытая переменная не превращается в админку, открытую на запись.

### Чек-лист выката этой версии

1. **Убрать `ADMIN_AUTH_DISABLED` из окружения.** Это первый и самый важный
   пункт: сейчас на проде эта переменная стоит в `true` (наследие прежней
   модели «авторизации нет вообще»), а `resolveAccess` в `src/lib/auth.ts`
   проверяет kill-switch **раньше всего остального** — раньше `ADMIN_USERS`,
   раньше fail-closed-503 прода, раньше вообще любой другой ветки решения.
   Если переменную не убрать, весь этот выкат — no-op: новая модель доступа
   не включится ни на грамм, и сервис останется публично **редактируемым**
   любым, кто знает адрес.
2. Задать `ADMIN_USERS` и `ADMIN_SESSION_SECRET` до перезапуска — иначе
   чтение продолжит работать, а любая запись будет отвечать 503, пока
   переменные не появятся.
3. Перезапустить сервис.
4. Проверить результат:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
     -H 'Content-Type: application/json' -d '{}' \
     https://funnels.ksamata.ru/api/funnels/1
   ```

   Ожидается `401` (запись без сессии отклонена). Если в ответе `200` —
   kill-switch всё ещё стоит, и его нужно убрать по пункту 1.

## Persistent volume

Mount a persistent volume at `/data` inside the container.

- On **first start** the entrypoint (`docker-entrypoint.sh`) detects that `/data/ksamata_funnels.db` is absent and copies the baked-in seed database from `/app/seed/ksamata_funnels.db`.
- On **subsequent starts** the file already exists — the copy is skipped and existing data is preserved.

## Migrations on start

After the seed check, the entrypoint runs the idempotent migration chain on
**every** start, in order:

1. `migrate-phase2.cjs` — `channels`/`directions` tables + funnel columns
2. `migrate-phase3.cjs` — `funnel_blocks`/`funnel_block_items` + one-time content move
3. `migrate-phase4.cjs` — `funnels.rooms_enabled` + backfill
4. `migrate-phase5.cjs` — `tag_templates` + `funnel_tag_overrides` + template seed
5. `backfill-legacy-tag-overrides.cjs` — preserves legacy non-AV tags as overrides

All steps are marker-gated or `IF NOT EXISTS`, so re-running them is safe.

> This seed + migration flow runs only for the **production** image
> (`app/Dockerfile` → `docker-entrypoint.sh`). The root `docker-compose.yml` dev
> stack uses `Dockerfile.dev`, skips the entrypoint, and mounts the real repo DB
> directly.

## Port

The container listens on **port 3000** (Next.js standalone server). Map it to whatever external port you need in Dokploy.

## Quick local test

```sh
docker build -t funnels-admin .           # run from app/
docker run --rm -d -p 3001:3000 \
  -e FUNNELS_DB_PATH=/data/ksamata_funnels.db \
  -v funnels_data:/data \
  --name funnels_test funnels-admin

curl -s localhost:3001/api/funnels | head -c 300
docker stop funnels_test
docker volume rm funnels_data
```
