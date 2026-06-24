# Funnels Admin — Фаза 2 — дизайн

**Дата:** 2026-06-25
**Статус:** одобрено пользователем
**Репозиторий:** `ksamata-funnels-db`, приложение в `app/` (продолжение Фазы 1)

## 1. Зачем

Доработка сервиса по обратной связи после просмотра Фазы 1: упростить форму,
сделать канал/направление выбираемыми, сгруппировать список, и — главное — дать
редактировать богатые данные воронки (вебинарные комнаты, ленды по дням) и
произвольные ссылки/дашборды.

## 2. Объём (7 пунктов фидбэка → A–F)

### A. Чистка формы воронки
- **Убрать поле «Источник»** из `FunnelForm`. `source_id` (NOT NULL FK) проставляется
  автоматически в `createFunnel`/`updateFunnel`: get-or-create источника с именем
  `«{channel} {contractor}»` (напр. «ВК NR»). При редактировании, если канал/подрядчик
  не меняются — источник не трогаем.
- **Убрать поле «Блок»** (`block_name`) из формы. Колонка остаётся в БД, не редактируется.
- `funnelCreateSchema`/`funnelUpdateSchema`: `sourceName` становится опциональным;
  `blockName` убирается из формы (схема может оставить его опциональным).

### B. Канал и Направление — селекты с добавлением
- Новые справочные таблицы `channels(id, name UNIQUE)` и `directions(id, name UNIQUE)`,
  сидятся текущими значениями из АВ-тегов:
  - каналы: Ютуб, Яндекс, ВК, МАКС, Перелив
  - направления: Органика, Реклама, РСЯ, In Stream, Маркетплатформа, Посевы, Ретаргет,
    Перелив с БОО, Перелив с ДБО, Квиз
- `/api/refs/[kind]` расширяет whitelist на `channels|directions` (тот же get-or-create).
- В `FunnelForm` Канал/Направление — селекты с инлайн-добавлением (как продукт/подрядчик).
- В `/refs` добавляются панели channels и directions.
- АВ-теги `АВ Канал: X` / `АВ Направление: X` по-прежнему создаются `axesToTagNames`
  при сохранении воронки — ref-таблицы лишь источник опций для селекта.

### C. Список — переключатель группировки
- Над списком — переключатель: **по подрядчику / по продукту / без группировки**.
  Карточки рендерятся секциями с заголовком группы и счётчиком. Без группировки —
  как сейчас. Выбор сохраняется в `localStorage`. Группировка клиентская:
  `GET /api/funnels` уже отдаёт `axes.contractor` и `axes.product`.

### D. Вебинарные комнаты + ленды — редактор «5 дней × 2 времени»
- В карточке воронки секция «Вебинарные комнаты и ленды»: сетка **5 дней ×
  (19:00 / 15:00)**. Каждая ячейка — 3 поля: `gc_room`, `web_room`, `sales_page`
  (столбцы таблицы `funnel_days`).
- API:
  - `GET /api/funnels/[id]/days` → массив до 10 объектов
    `{ timeSlot, dayNum, gcRoom, webRoom, salesPage }` (только заполненные/существующие).
  - `PUT /api/funnels/[id]/days` → принимает полный набор ячеек (до 10); в одной
    транзакции **реконсилирует** `funnel_days`: upsert по `(funnel_id, time_slot,
    day_num)`; ячейка, где все три поля пусты, — удаляется (если была).
  - **Остальные столбцы `funnel_days`** (replay, tariffs, oto, bonuses, mission и т.д.)
    в Фазе 2 не редактируются и при upsert сохраняют существующие значения
    (UPDATE только трёх полей; при INSERT — дефолты `''`).
- Помощник `app/src/lib/funnel-days.ts`: `listDays(db, funnelId)`,
  `replaceDays(db, funnelId, cells)`.

### E. Гибкие доп.поля (ссылки/дашборды)
- Новая таблица `funnel_links(id, funnel_id REFERENCES funnels ON DELETE CASCADE,
  label TEXT, url TEXT, position INTEGER)`.
- В карточке секция «Ссылки / дашборды»: список пар «название → URL» с добавлением,
  удалением, переупорядочиванием.
- API:
  - `GET /api/funnels/[id]/links` → `[{ id, label, url, position }]` по `position`.
  - `PUT /api/funnels/[id]/links` → принимает полный список; в транзакции заменяет
    (delete all + insert) набор ссылок воронки, `position` = индекс.
- Рендер `url` как `<a href>` только при `http(s)://` (тот же `isSafeUrl`-гард).
- Помощник `app/src/lib/funnel-links.ts`: `listLinks(db, funnelId)`,
  `replaceLinks(db, funnelId, items)`.

### F. Что НЕ меняем
АВ-логика/теги, существующие колонки (`room_ids_json`, `dash_*`, `regi_*`,
`block_name`, `predspisok_url`) остаются в БД нетронутыми. Деплой (Docker/Dokploy)
не меняется — новые таблицы создаются миграцией, в т.ч. при первом старте на volume.

## 3. Изменения схемы (миграция)

Идемпотентная миграция (после бэкапа БД):
```sql
CREATE TABLE IF NOT EXISTS channels   (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS directions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS funnel_links (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  label     TEXT NOT NULL DEFAULT '',
  url       TEXT NOT NULL DEFAULT '',
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_funnel_links_funnel ON funnel_links(funnel_id);
```
Затем seed `channels`/`directions` из distinct значений АВ-тегов (идемпотентно,
get-or-create). Drizzle-схема (`app/src/db/schema.ts`) дополняется тремя таблицами.

Миграция должна примениться и в Docker. На volume может лежать БД Фазы 1 без этих
таблиц, поэтому `app/docker-entrypoint.sh` **после** сидирования volume и **перед**
`exec node server.js` запускает идемпотентный миграционный скрипт
(`app/scripts/migrate-phase2.ts` или общий `migrate`), который создаёт
`channels/directions/funnel_links` (CREATE IF NOT EXISTS) и сидит channels/directions.
Скрипт безопасен при повторных запусках (на каждом деплое).

## 4. Изменения API (сводно)
- `/api/refs/[kind]`: whitelist += `channels`, `directions`.
- `/api/funnels/[id]/days`: `GET`, `PUT` (reconcile).
- `/api/funnels/[id]/links`: `GET`, `PUT` (replace).
- `createFunnel`/`updateFunnel`: авто-источник из `{channel} {contractor}`, если
  `sourceName` не передан.

## 5. Изменения UI (сводно)
- `FunnelForm`: убрать Источник/Блок; Канал/Направление → `RefSelect` c добавлением;
  две новые секции — «Вебинарные комнаты и ленды» (сетка 5×2) и «Ссылки / дашборды»
  (список пар). Сохранение формы и дочерних секций — корректными запросами к API.
- Список (`page.tsx`): переключатель группировки (подрядчик/продукт/без) + секции.
- `/refs`: панели channels и directions.

## 6. Обработка ошибок
- Валидация: `label`/`url` строки; `url` либо пусто, либо валидный URL (рендер
  как ссылка — только http(s)). `day_num` 1..5, `time_slot` ∈ '19'|'15'.
- Все мульти-записи (days reconcile, links replace, авто-источник) в транзакциях.
- Бэкап БД перед миграцией схемы.

## 7. Тестирование
- Юнит (temp-копия БД): `funnel-days` (reconcile: upsert + удаление пустых, сохранность
  прочих столбцов), `funnel-links` (replace + position), авто-источник в `createFunnel`
  (при отсутствии `sourceName`), refs расширенные kinds (channels/directions),
  миграция/seed (channels/directions созданы и наполнены).
- Сборка и полный прогон Vitest зелёные; ручная проверка `/`, карточки с сеткой и
  ссылками, `/refs`.

## 8. Критерии готовности
- Форма без Источника/Блока; Канал/Направление выбираются и пополняются.
- Список группируется переключателем.
- В карточке редактируются комнаты+ленды (5×2) и произвольные ссылки/дашборды,
  сохраняются в БД.
- Миграция применяется локально и в Docker; деплой не сломан.
- Тесты и сборка зелёные.
