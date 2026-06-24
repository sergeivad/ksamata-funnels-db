# Funnels Admin Фаза 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Доработать редактор воронок: убрать лишние поля, селекты канал/направление, группировка списка, редактор вебинарных комнат+лендов (5 дней × 2 времени) и произвольных ссылок/дашбордов.

**Architecture:** Те же слои, что в Фазе 1: Drizzle-схема + помощники в `app/src/lib/*` (инъекция db-хендла, тестируются на temp-копии БД), тонкие App Router роуты, презентационные клиент-компоненты. Новые таблицы `channels`/`directions`/`funnel_links`. Богатые данные дня живут в существующей `funnel_days`.

**Tech Stack:** Next.js 15, TypeScript, Tailwind, lucide-react, Drizzle + better-sqlite3, Vitest.

## Global Constraints

- Приложение в `app/`. Node ≥ 20. App Router. DB-путь из env `FUNNELS_DB_PATH`, дефолт = repo-root db (cwd-relative).
- Помощники принимают инъецированный db-хендл первым аргументом; тесты используют ТОЛЬКО temp-копию `ksamata_funnels.db` (никогда не открывают реальный файл).
- Все мульти-записи — в транзакциях. Бэкап БД перед миграцией схемы.
- Реальный `ksamata_funnels.db` git-трекается; миграция применяется к нему и коммитится.
- `funnel_days`: `time_slot` ∈ '19'|'15'; `day_num` 1..5. В Фазе 2 редактируются ТОЛЬКО `gc_room, web_room, sales_page`; прочие столбцы не затрагиваются (UPDATE только трёх; INSERT — дефолты).
- АВ-теги `АВ Канал: X` / `АВ Направление: X` по-прежнему генерит `axesToTagNames` — новые ref-таблицы лишь источник опций.
- Рендер любого URL ссылкой — только при `http(s)://` (`isSafeUrl`).
- Не трогать Python-скрипты, существующие колонки (`room_ids_json`, `dash_*`, `regi_*`, `block_name`).
- Коммиты заканчиваются `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Миграция + схема + seed (channels/directions/funnel_links)

**Files:**
- Modify: `app/src/db/schema.ts` (добавить 3 таблицы)
- Create: `app/scripts/migrate-phase2.ts` (идемпотентная миграция + seed), `app/tests/migrate-phase2.test.ts`

**Interfaces:**
- Produces: Drizzle-таблицы `channels {id,name}`, `directions {id,name}`, `funnelLinks {id, funnelId, label, url, position}`. Функция `runMigratePhase2(db)`.

- [ ] **Step 1: Тест** (temp-копия БД): после `runMigratePhase2(db)` таблицы существуют; `channels` содержит ['Ютуб','Яндекс','ВК','МАКС','Перелив']; `directions` содержит 'Органика'/'РСЯ'/'In Stream' и т.д.; повторный вызов не плодит дубли; `funnel_links` пустая и принимает вставку.

```ts
test('migrate creates tables and seeds channels/directions idempotently', () => {
  runMigratePhase2(db);
  runMigratePhase2(db); // idempotent
  const ch = db.select().from(channels).all().map(r => r.name);
  expect(ch).toEqual(expect.arrayContaining(['Ютуб','Яндекс','ВК','МАКС','Перелив']));
  const dir = db.select().from(directions).all().map(r => r.name);
  expect(dir).toEqual(expect.arrayContaining(['Органика','Реклама','РСЯ','In Stream','Квиз']));
});
```

- [ ] **Step 2: Запустить — упадёт.** Run: `cd app && npx vitest run tests/migrate-phase2.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать.** Добавить таблицы в `schema.ts` (см. спека §3 DDL). `migrate-phase2.ts`: `CREATE TABLE IF NOT EXISTS` для трёх таблиц + индекс; seed channels/directions get-or-create из явных списков (значения из спеки §B). CLI-вход применяет к реальной БД.

- [ ] **Step 4: Тест зелёный.** Run: `cd app && npx vitest run tests/migrate-phase2.test.ts`. Expected: PASS.

- [ ] **Step 5: Применить к реальной БД и закоммитить.** `cp ksamata_funnels.db ksamata_funnels.db.bak-before-phase2` (из корня, gitignored); `cd app && FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase2.ts`; проверить `sqlite3 ksamata_funnels.db "SELECT name FROM channels;"`. Закоммитить `schema.ts`, `migrate-phase2.ts`, тест и обновлённый `ksamata_funnels.db`.

---

### Task 2: Refs API — channels/directions + панели в /refs

**Files:**
- Modify: `app/src/lib/refs.ts` (whitelist), `app/src/app/refs/page.tsx` (+2 панели)
- Test: `app/tests/api-refs.test.ts` (дополнить)

**Interfaces:**
- Consumes: `channels`, `directions` из Task 1.
- Produces: `/api/refs/channels` и `/api/refs/directions` (GET список, POST get-or-create).

- [ ] **Step 1: Тест** — добавить в `api-refs.test.ts`: GET `channels` возвращает сидированные значения; POST новый канал «ТестКанал» → появляется, повтор не дублирует; GET `directions` непустой.

- [ ] **Step 2: Запустить — упадёт** (kind не в whitelist). Run: `cd app && npx vitest run tests/api-refs.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать.** В `refs.ts` добавить `channels`→`channels`, `directions`→`directions` в whitelist-карту (kind→таблица). Без интерполяции kind в SQL.

- [ ] **Step 4: Тест зелёный.** Expected: PASS.

- [ ] **Step 5: UI** — в `app/src/app/refs/page.tsx` добавить две панели `RefTable` для channels и directions (как существующие). Сборка `cd app && npm run build` зелёная.

- [ ] **Step 6: Commit** `feat(phase2): channels/directions refs API + /refs panels`.

---

### Task 3: Авто-источник + изменения валидации

**Files:**
- Modify: `app/src/lib/funnels.ts` (`createFunnel`/`updateFunnel`), `app/src/lib/validation.ts`
- Test: `app/tests/api-funnels.test.ts` (дополнить)

**Interfaces:**
- Consumes: `createRef` (sources).
- Produces: `funnelCreateSchema.sourceName` опционально; `blockName` опционально. `createFunnel`/`updateFunnel` при отсутствии `sourceName` выводят источник = get-or-create `«{channel} {contractor}»`.

- [ ] **Step 1: Тест** — создать воронку БЕЗ `sourceName` (оси Канал='ВК', Подрядчик='NR') → у воронки `source_id` указывает на источник с именем `'ВК NR'` (создан, если не было). С переданным `sourceName` — используется он.

- [ ] **Step 2: Запустить — упадёт.** Run: `cd app && npx vitest run tests/api-funnels.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать.** В `validation.ts` сделать `sourceName` и `blockName` `.optional()`. В `funnels.ts` `createFunnel`/`updateFunnel`: `const srcName = input.sourceName?.trim() || \`${input.channel} ${input.contractor}\`;` затем get-or-create source. На update без смены осей/источника — не трогать существующий source_id (если sourceName не передан и оси не меняются, оставить как есть).

- [ ] **Step 4: Тест зелёный.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(phase2): auto-derive source from channel+contractor; optional sourceName/blockName`.

---

### Task 4: funnel-days helper + API

**Files:**
- Create: `app/src/lib/funnel-days.ts`, `app/src/app/api/funnels/[id]/days/route.ts`, `app/tests/funnel-days.test.ts`

**Interfaces:**
- Produces:
  - `type DayCell = { timeSlot: '19'|'15'; dayNum: number; gcRoom: string; webRoom: string; salesPage: string }`
  - `listDays(db, funnelId): DayCell[]` — существующие строки funnel_days (только 3 поля + ключи).
  - `replaceDays(db, funnelId, cells: DayCell[]): void` — в транзакции: для каждой ячейки upsert по `(funnel_id,time_slot,day_num)` (UPDATE только gc_room/web_room/sales_page или INSERT с этими полями + остальные дефолты); ячейка со всеми тремя пустыми — удаляется, если строка была.

- [ ] **Step 1: Тест** (temp-копия): для воронки без дней `replaceDays` с одной ячейкой (19,1,gc,web,sales) создаёт строку; `listDays` её возвращает; повторный replace с пустой ячейкой (19,1,'','','') удаляет строку; **сохранность**: если у воронки была строка с заполненным `tariffs`, replaceDays на её gc_room не затирает `tariffs`.

- [ ] **Step 2: Запустить — упадёт.** Run: `cd app && npx vitest run tests/funnel-days.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать** `funnel-days.ts` (upsert через SELECT-then-UPDATE/INSERT или `onConflictDoUpdate` по уникальному `(funnel_id,time_slot,day_num)`, обновляя только 3 поля).

- [ ] **Step 4: Тест зелёный.** Expected: PASS.

- [ ] **Step 5: API** — `app/src/app/api/funnels/[id]/days/route.ts`: `GET` → `listDays`; `PUT` (body `{cells: DayCell[]}`, валидировать timeSlot/dayNum) → `replaceDays`, 404 если воронки нет.

- [ ] **Step 6: Commit** `feat(phase2): funnel-days helper + days API`.

---

### Task 5: funnel-links helper + API

**Files:**
- Create: `app/src/lib/funnel-links.ts`, `app/src/app/api/funnels/[id]/links/route.ts`, `app/tests/funnel-links.test.ts`

**Interfaces:**
- Consumes: `funnelLinks` из Task 1.
- Produces:
  - `type LinkItem = { label: string; url: string }`
  - `listLinks(db, funnelId): {id:number,label:string,url:string,position:number}[]` (по position).
  - `replaceLinks(db, funnelId, items: LinkItem[]): void` — в транзакции delete-all + insert с `position=index`.

- [ ] **Step 1: Тест** (temp-копия): `replaceLinks(db, fid, [{label:'Дашборд',url:'https://x'},{label:'Отчёт',url:'https://y'}])` → `listLinks` возвращает 2 в порядке position 0,1; повторный replace с одним элементом оставляет 1; пустой массив очищает.

- [ ] **Step 2: Запустить — упадёт.** Run: `cd app && npx vitest run tests/funnel-links.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать** `funnel-links.ts`.

- [ ] **Step 4: Тест зелёный.** Expected: PASS.

- [ ] **Step 5: API** — `app/src/app/api/funnels/[id]/links/route.ts`: `GET` → `listLinks`; `PUT` (body `{items: LinkItem[]}`) → `replaceLinks`, 404 если воронки нет.

- [ ] **Step 6: Commit** `feat(phase2): funnel-links helper + links API`.

---

### Task 6: FunnelForm — убрать Источник/Блок, селекты Канал/Направление

**Files:**
- Modify: `app/src/components/FunnelForm.tsx`

**Interfaces:**
- Consumes: `/api/refs/channels`, `/api/refs/directions` (RefSelect c добавлением); auto-source (Task 3 — форма просто НЕ шлёт `sourceName`).

- [ ] **Step 1: Реализовать.** Убрать поля «Источник» (`sourceName`) и «Блок» (`blockName`) из формы и из отправляемого тела. Канал и Направление — через тот же `RefSelect`, что продукт/подрядчик, источник опций `channels`/`directions`, с инлайн-добавлением через POST `/api/refs/<kind>`. На submit `sourceName` не отправляется (бэкенд выведет сам).

- [ ] **Step 2: Проверка.** `cd app && npm run build` зелёная; `npx vitest run` зелёный (форма без юнит-тестов, но ничего не сломано). Ручная проверка `/funnels/new`: нет Источника/Блока, Канал/Направление — селекты с «+ добавить».

- [ ] **Step 3: Commit** `feat(phase2): drop source/block fields; channel/direction selects`.

---

### Task 7: Редактор «5 дней × 2 времени» (комнаты + ленды)

**Files:**
- Create: `app/src/components/DaysEditor.tsx`
- Modify: `app/src/app/funnels/[id]/page.tsx` (встроить секцию)

**Interfaces:**
- Consumes: `GET/PUT /api/funnels/[id]/days` (Task 4).
- Produces: `<DaysEditor funnelId initialDays />` (client component).

- [ ] **Step 1: Реализовать** секцию «Вебинарные комнаты и ленды» в карточке воронки: сетка 5 дней × (19:00/15:00), каждая ячейка — 3 инпута (GC-комната, web-комната, страница-ленд). Кнопка «Сохранить комнаты» шлёт `PUT .../days` с полным набором ячеек; Toast-фидбэк. Загрузка — `GET .../days` (или server-fetch initialDays на странице `[id]`). Стиль — кремовые токены, аккуратная сетка.

- [ ] **Step 2: Проверка.** `npm run build` зелёная; ручная проверка на воронке с данными (напр. num32 ДЫХАНИЕ — 10 заполненных ячеек) и на скелете (num35 ТКМ — пусто, заполнить и сохранить).

- [ ] **Step 3: Commit** `feat(phase2): days/rooms/lands editor (5x2 grid)`.

---

### Task 8: Редактор ссылок/дашбордов (гибкие поля)

**Files:**
- Create: `app/src/components/LinksEditor.tsx`
- Modify: `app/src/app/funnels/[id]/page.tsx` (встроить секцию)

**Interfaces:**
- Consumes: `GET/PUT /api/funnels/[id]/links` (Task 5).
- Produces: `<LinksEditor funnelId initialLinks />`.

- [ ] **Step 1: Реализовать** секцию «Ссылки / дашборды»: список пар «название → URL» с добавлением (кнопка «+»), удалением (корзина), переупорядочиванием (вверх/вниз). «Сохранить ссылки» шлёт `PUT .../links`. Рендер URL ссылкой только при http(s) (`isSafeUrl`). Toast-фидбэк.

- [ ] **Step 2: Проверка.** `npm run build` зелёная; ручная проверка: добавить «Дашборд продаж → https://…», сохранить, перезагрузить — сохранилось.

- [ ] **Step 3: Commit** `feat(phase2): funnel links/dashboards editor`.

---

### Task 9: Список — переключатель группировки

**Files:**
- Modify: `app/src/app/page.tsx`
- Create (опц.): `app/src/components/GroupToggle.tsx`

**Interfaces:**
- Consumes: `GET /api/funnels` (уже отдаёт `axes.contractor`, `axes.product`).

- [ ] **Step 1: Реализовать.** Над списком — переключатель «по подрядчику / по продукту / без группировки» (3 кнопки). При выбранной группировке карточки рендерятся секциями с заголовком группы и счётчиком; «без» — плоский список как сейчас. Выбор в `localStorage` (ключ `funnels.groupBy`). Сортировка групп по алфавиту; внутри — по `num`.

- [ ] **Step 2: Проверка.** `npm run build` зелёная; ручная: переключение меняет секции; «без группировки» = старый вид; выбор переживает перезагрузку.

- [ ] **Step 3: Commit** `feat(phase2): funnel list grouping toggle (contractor/product/none)`.

---

### Task 10: Docker — применять миграцию Фазы 2 на старте

**Files:**
- Modify: `app/docker-entrypoint.sh`, `app/Dockerfile` (если нужно положить tsx/скрипт в runner)

**Interfaces:**
- Consumes: `app/scripts/migrate-phase2.ts` (Task 1).

- [ ] **Step 1: Реализовать.** В `docker-entrypoint.sh` ПОСЛЕ сидирования volume и ПЕРЕД `exec node server.js` запускать идемпотентную миграцию Фазы 2 против `$FUNNELS_DB_PATH` (создаёт channels/directions/funnel_links, сидит channels/directions). Способ: либо включить `tsx` + скрипт в runner-образ, либо предкомпилировать миграцию в JS и звать `node`. Выбрать рабочий вариант и убедиться, что better-sqlite3 в runner доступен миграции.

- [ ] **Step 2: Проверка (Docker есть).** `cd app && docker build -t funnels-admin .` успешно. Запустить контейнер на чистом volume с БД Фазы 1 (без новых таблиц) — например, скопировать seed без таблиц; убедиться, что после старта `curl localhost:PORT/api/refs/channels` отдаёт сидированные каналы (миграция отработала). Остановить/удалить контейнер и тест-volume.

- [ ] **Step 3: Commit** `feat(phase2): run phase-2 migration on container start`.

---

## Self-Review

**Spec coverage:**
- §A (убрать Источник/Блок, авто-источник) → Task 3 (логика) + Task 6 (форма). §B (channels/directions селекты) → Task 1 (таблицы/seed) + Task 2 (API + /refs) + Task 6 (форма). §C (группировка) → Task 9. §D (комнаты/ленды 5×2) → Task 4 (API) + Task 7 (UI). §E (гибкие ссылки) → Task 1 (таблица) + Task 5 (API) + Task 8 (UI). §F (не трогаем) → Global Constraints. §3 миграция → Task 1; Docker-миграция → Task 10. §7 тесты → Tasks 1,3,4,5 (+refs 2).

**Placeholder scan:** логика (миграция, авто-источник, days/links) дана конкретно; UI описан через требования к секциям (визуальные задачи).

**Type consistency:** `DayCell`, `LinkItem`, `listDays/replaceDays`, `listLinks/replaceLinks`, `runMigratePhase2`, ref-kinds `channels|directions` — согласованы между Task 1/2/4/5/7/8.

**Открытый момент (не блокер):** на update без передачи `sourceName` и без смены осей источник не пересчитывается (Task 3) — поведение зафиксировано в плане.
