# Funnels Admin (Фаза 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Веб-сервис управления воронками (CRUD ядра, статусы, справочники) поверх существующей `ksamata_funnels.db`, в кремовом «ксаматовском» дизайне, деплой через Dokploy.

**Architecture:** Next.js (App Router) — фронт + API в одном процессе. Drizzle ORM поверх better-sqlite3 читает/пишет существующий файл БД. Логика «4 АВ-оси ↔ строки `funnel_tags`» изолирована в `lib/ab-tags`. Один Docker-контейнер; БД на персистентном volume Dokploy.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, lucide-react, Drizzle ORM, better-sqlite3, Vitest.

## Global Constraints

- Node ≥ 20. Next.js App Router (не Pages Router).
- Приложение живёт в подпапке `app/` репозитория `ksamata-funnels-db`.
- Путь к БД — из env `FUNNELS_DB_PATH`, дефолт `../ksamata_funnels.db` (в проде — путь на volume).
- Не переписывать существующие Python-скрипты `add_*.py`; они трогают тот же файл БД.
- Все денежные/идентификационные строки и коды — без изменений семантики из спеки.
- Дизайн-токены (цвета, радиусы, шрифты) брать из `../UTM-стандарт/Стандарт рекламы — UTM и кабинеты.html` (`:root` CSS-переменные) — единый стиль.
- `time_slot` в БД — только `'19'` / `'15'`; `day_num` 1..5; `tag_type` ∈ `reg|time_19|time_15`.
- Перед любой миграцией схемы — бэкап файла БД в `*.bak-before-<change>`.
- Фаза 1 НЕ трогает `funnel_days`, `salebot_configs`, `product_durations` (только чтение для будущего; не редактируем).

---

## File Structure

```
app/
  package.json, tsconfig.json, next.config.ts, tailwind.config.ts, postcss.config.mjs
  Dockerfile, .dockerignore, .env.example
  drizzle.config.ts
  drizzle/                         # сгенерированные SQL-миграции
  src/
    db/
      schema.ts                    # Drizzle-схема всех таблиц (+ status, front_code)
      client.ts                    # singleton better-sqlite3 + drizzle
    lib/
      ab-tags.ts                   # маппинг 4 осей <-> funnel_tags (чистые функции)
      validation.ts                # zod-схемы входа API
      tokens.css                   # CSS-переменные дизайна (из UTM HTML)
    app/
      layout.tsx, globals.css      # подключение tokens.css + Tailwind
      page.tsx                     # список воронок (server component)
      funnels/[id]/page.tsx        # карточка/редактор воронки
      funnels/new/page.tsx         # создание
      refs/page.tsx                # справочники
      api/
        funnels/route.ts           # GET список, POST создать
        funnels/[id]/route.ts      # GET, PATCH, DELETE
        funnels/[id]/duplicate/route.ts  # POST дублировать
        refs/[kind]/route.ts       # GET список, POST добавить (products|contractors|sources|tags)
    components/
      CodeChip.tsx, StatusPill.tsx, FunnelCard.tsx, FunnelForm.tsx,
      RefTable.tsx, Toast.tsx
  tests/
    ab-tags.test.ts, validation.test.ts, api-funnels.test.ts
  scripts/
    seed-phase1.ts                 # 3 продукта + 6 воронок-скелетов + status/front_code
```

---

### Task 1: Скаффолд приложения и дизайн-токены

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/next.config.ts`, `app/tailwind.config.ts`, `app/postcss.config.mjs`, `app/.env.example`, `app/src/lib/tokens.css`, `app/src/app/globals.css`, `app/src/app/layout.tsx`, `app/src/app/page.tsx` (заглушка)

**Interfaces:**
- Produces: рабочий `npm run dev` отдаёт пустую страницу с применёнными CSS-переменными.

- [ ] **Step 1: Инициализировать Next.js + зависимости**

```bash
cd app
npm init -y
npm i next@15 react react-dom better-sqlite3 drizzle-orm lucide-react zod
npm i -D typescript @types/react @types/node @types/better-sqlite3 tailwindcss postcss autoprefixer drizzle-kit vitest @vitejs/plugin-react
npx tailwindcss init -p
```

- [ ] **Step 2: Извлечь дизайн-токены из UTM HTML**

Прочитать `:root { --color-... }` из `../UTM-стандарт/Стандарт рекламы — UTM и кабинеты.html` и перенести в `app/src/lib/tokens.css` (минимум: `--color-bg`, `--color-bg-panel`, `--color-border-soft`, `--color-text`, `--color-text-secondary`, акцент `#111`, шрифты). `globals.css` импортирует `tokens.css` + директивы Tailwind. Фон страницы — кремовый из токенов.

- [ ] **Step 3: Проверить запуск**

Run: `npm run dev` → открыть localhost:3000. Expected: страница с кремовым фоном, без ошибок консоли.

- [ ] **Step 4: Commit**

```bash
git add app && git commit -m "feat(funnels-admin): scaffold Next.js app + design tokens"
```

---

### Task 2: Drizzle-схема + миграция (status, front_code)

**Files:**
- Create: `app/src/db/schema.ts`, `app/src/db/client.ts`, `app/drizzle.config.ts`
- Modify (через миграцию): таблица `funnels` в `ksamata_funnels.db`

**Interfaces:**
- Produces: `db` (drizzle client), таблицы `funnels, products, contractors, sources, tags, funnelTags, funnelDays`. Колонки `funnels.status` (text, default `'active'`), `funnels.frontCode` (text, default `''`).

- [ ] **Step 1: Описать схему существующих таблиц в `schema.ts`**

Отразить точно текущую схему (см. спеку §3 и `.schema`): `funnels` (все поля + новые `status`, `front_code`), `products/contractors/sources/tags` (id, name), `funnel_tags` (funnel_id, tag_id, tag_type, position), `funnel_days` (read-only для Фазы 1). FK и UNIQUE как в БД.

- [ ] **Step 2: Бэкап БД и миграция**

```bash
cp ../ksamata_funnels.db ../ksamata_funnels.db.bak-before-status
```
Миграция SQL (через drizzle-kit или вручную, идемпотентно):
```sql
ALTER TABLE funnels ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE funnels ADD COLUMN front_code TEXT DEFAULT '';
```

- [ ] **Step 3: Проверить, что схема читается**

Run: скрипт `npx tsx -e "import {db} from './src/db/client'; import {funnels} from './src/db/schema'; console.log(db.select().from(funnels).all().length)"`
Expected: `32`.

- [ ] **Step 4: Commit**

```bash
git add app/src/db app/drizzle.config.ts && git commit -m "feat(funnels-admin): drizzle schema + status/front_code migration"
```

---

### Task 3: Бэкофилл status/front_code существующим воронкам

**Files:**
- Create: `app/scripts/backfill-status.ts`

**Interfaces:**
- Consumes: `db`, схема из Task 2.
- Produces: у 32 воронок `status='active'`, `front_code='f'+num` (по умолчанию). Для num27–32 front_code подлежит ручной правке позже (см. спеку §3).

- [ ] **Step 1: Написать тест** `tests/backfill.test.ts` против временной копии БД: после запуска все строки имеют непустой `front_code` и `status='active'`.

```ts
test('backfill sets status and front_code', () => {
  runBackfill(testDb);
  const rows = testDb.select().from(funnels).all();
  expect(rows.every(r => r.status === 'active')).toBe(true);
  expect(rows.every(r => /^f\d+$/.test(r.frontCode))).toBe(true);
});
```

- [ ] **Step 2: Запустить — упадёт** (`runBackfill` не определён). Run: `npx vitest run tests/backfill.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать `runBackfill(db)`**: `UPDATE funnels SET status='active' WHERE status IS NULL OR status=''; SET front_code='f'||num WHERE front_code=''`.

- [ ] **Step 4: Тест проходит.** Run: `npx vitest run tests/backfill.test.ts`. Expected: PASS. Затем выполнить против реальной БД: `npx tsx scripts/backfill-status.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/scripts app/tests/backfill.test.ts && git commit -m "feat(funnels-admin): backfill status/front_code for existing funnels"
```

---

### Task 4: `lib/ab-tags` — маппинг 4 осей ↔ funnel_tags (TDD)

**Files:**
- Create: `app/src/lib/ab-tags.ts`, `app/tests/ab-tags.test.ts`

**Interfaces:**
- Produces:
  - `type AbAxes = { product: string; contractor: string; channel: string; direction: string }`
  - `axesToTagNames(axes: AbAxes): { reg: string[]; time19: string[]; time15: string[] }` — формирует имена АВ-тегов (`АВ Продукт: X`, `АВ Подрядчик: X`, `АВ Канал: X`, `АВ Направление: X`, + стандартные `АВ Автоворонка`, `АВ Этап: Регистрация` для reg; `АВ Этап: Оплата`, `АВ Время: 19/15` для time-слотов).
  - `tagNamesToAxes(regTagNames: string[]): AbAxes` — обратный разбор из reg-тегов.

- [ ] **Step 1: Тесты обоих направлений**

```ts
const axes = { product: 'ТКМ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' };
test('axesToTagNames builds reg + time tags', () => {
  const r = axesToTagNames(axes);
  expect(r.reg).toContain('АВ Продукт: ТКМ');
  expect(r.reg).toContain('АВ Подрядчик: НИМБ');
  expect(r.reg).toContain('АВ Канал: Яндекс');
  expect(r.reg).toContain('АВ Направление: РСЯ');
  expect(r.reg).toContain('АВ Этап: Регистрация');
  expect(r.time19).toContain('АВ Время: 19');
  expect(r.time15).toContain('АВ Время: 15');
});
test('tagNamesToAxes is inverse of axesToTagNames', () => {
  expect(tagNamesToAxes(axesToTagNames(axes).reg)).toEqual(axes);
});
```

- [ ] **Step 2: Запустить — упадёт.** Run: `npx vitest run tests/ab-tags.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать чистые функции** по правилам выше (префиксы `АВ <Ось>: <значение>`).

- [ ] **Step 4: Тесты проходят.** Run: `npx vitest run tests/ab-tags.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ab-tags.ts app/tests/ab-tags.test.ts && git commit -m "feat(funnels-admin): ab-tags axis<->tag mapping"
```

---

### Task 5: Валидация входа (`lib/validation.ts`) (TDD)

**Files:**
- Create: `app/src/lib/validation.ts`, `app/tests/validation.test.ts`

**Interfaces:**
- Produces (zod):
  - `funnelCreateSchema` / `funnelUpdateSchema` — поля: `num` (int>0), `frontCode` (regex `^f\d+$`), `status` (`'active'|'draft'`), `productName`, `variant`, `landingUrl` (url|''), `startDate` (''|`YYYY-MM-DD`), `blockName`, и АВ-оси `product/contractor/channel/direction` (непустые), `sourceName`.
  - `refCreateSchema` — `{ name: string (1..120) }`.

- [ ] **Step 1: Тесты** — валидный объект проходит; `frontCode='x7'` отвергается; `status='foo'` отвергается; пустой `product` отвергается.

- [ ] **Step 2: Запустить — упадёт.** Run: `npx vitest run tests/validation.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать zod-схемы.**

- [ ] **Step 4: Тесты проходят.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(funnels-admin): zod request validation`.

---

### Task 6: API — справочники (`/api/refs/[kind]`) (TDD)

**Files:**
- Create: `app/src/app/api/refs/[kind]/route.ts`, `app/tests/api-refs.test.ts`

**Interfaces:**
- Consumes: `db`, `refCreateSchema`.
- Produces: `GET /api/refs/products|contractors|sources|tags` → `[{id,name}]`; `POST` с `{name}` → создаёт (get-or-create, без дублей), 400 при невалидном `kind` или имени.

- [ ] **Step 1: Тест** против временной БД: POST новый продукт `ТКМ` → появляется в GET; повторный POST `ТКМ` не плодит дубль; `kind='bogus'` → 400.

- [ ] **Step 2: Запустить — упадёт.** Run: `npx vitest run tests/api-refs.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать роут** (whitelist kind→таблица; get-or-create по `name`).

- [ ] **Step 4: Тесты проходят.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(funnels-admin): refs CRUD API`.

---

### Task 7: API — воронки (`/api/funnels`, `/[id]`, `/duplicate`) (TDD)

**Files:**
- Create: `app/src/app/api/funnels/route.ts`, `app/src/app/api/funnels/[id]/route.ts`, `app/src/app/api/funnels/[id]/duplicate/route.ts`, `app/tests/api-funnels.test.ts`

**Interfaces:**
- Consumes: `db`, `funnelCreateSchema`, `funnelUpdateSchema`, `axesToTagNames`, `tagNamesToAxes`, get-or-create справочников.
- Produces:
  - `GET /api/funnels` → список `{id,num,frontCode,status,productName,axes}` (axes из reg-тегов).
  - `POST /api/funnels` → создаёт воронку: get-or-create product/contractor/source, вставка строки, синхронизация АВ-тегов (reg+time19+time15) идемпотентно. Уникальность `num`.
  - `GET/PATCH/DELETE /api/funnels/[id]` → чтение/правка (включая статус и оси → пересинхрон тегов)/удаление (каскад funnel_tags).
  - `POST /api/funnels/[id]/duplicate` → копия с `num = max(num)+1`, `frontCode=''`, `status='draft'`, теми же осями.

- [ ] **Step 1: Тесты** (временная БД): создать воронку с осями ТКМ/НИМБ/Яндекс/РСЯ → GET показывает её, reg-теги содержат `АВ Продукт: ТКМ`; PATCH статуса на `draft`; duplicate даёт новый num и status=draft; DELETE убирает воронку и её funnel_tags; POST с занятым `num` → 409.

- [ ] **Step 2: Запустить — упадёт.** Run: `npx vitest run tests/api-funnels.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать роуты** (всё в транзакциях; пересинхрон тегов = удалить АВ-теги воронки данного tag_type и вставить заново по `axesToTagNames`).

- [ ] **Step 4: Тесты проходят.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(funnels-admin): funnels CRUD + duplicate API`.

---

### Task 8: UI-компоненты (CodeChip, StatusPill, FunnelCard, RefTable, Toast)

**Files:**
- Create: `app/src/components/CodeChip.tsx`, `StatusPill.tsx`, `FunnelCard.tsx`, `RefTable.tsx`, `Toast.tsx`

**Interfaces:**
- Consumes: дизайн-токены.
- Produces: `<CodeChip code="f33"/>` (моно-чип), `<StatusPill status="active|draft"/>` (зелёная/бежевая пилюля), `<FunnelCard funnel onActivate onDuplicate onDelete/>` (карточка как в макете: чип + заголовок `Продукт / Подрядчик / Канал / Направление` + пилюля + иконки-кнопки lucide), `<RefTable kind rows onAdd/>`.

- [ ] **Step 1: Сверстать компоненты** строго по макету (классы Tailwind + токены; иконки lucide: play/pause, copy, trash2, chevron-right).

- [ ] **Step 2: Визуальная проверка** на странице-песочнице: карточка совпадает с макетом со скрина.

- [ ] **Step 3: Commit** `feat(funnels-admin): UI components`.

---

### Task 9: Страницы (список / карточка / создание / справочники)

**Files:**
- Create: `app/src/app/page.tsx`, `app/src/app/funnels/[id]/page.tsx`, `app/src/app/funnels/new/page.tsx`, `app/src/app/refs/page.tsx`, `app/src/components/FunnelForm.tsx`

**Interfaces:**
- Consumes: API из Task 6–7, компоненты из Task 8.
- Produces:
  - `/` — server component: грузит `GET /api/funnels`, рендерит шапку «Проектные воронки», счётчик «N всего», сетку `FunnelCard`. Кнопки карточки дёргают API с оптимистичным апдейтом + Toast.
  - `/funnels/new` и `/funnels/[id]` — `FunnelForm` (поля ядра + селекты осей с возможностью создать новое значение через `/api/refs`).
  - `/refs` — таблицы справочников с добавлением.

- [ ] **Step 1: Реализовать страницы и `FunnelForm`.**

- [ ] **Step 2: Ручная проверка:** список показывает 32 воронки; создание новой воронки появляется в списке; смена статуса меняет пилюлю; добавление продукта в `/refs` доступно в форме.

- [ ] **Step 3: Commit** `feat(funnels-admin): list/card/new/refs pages`.

---

### Task 10: Первое наполнение (3 продукта + 6 воронок-скелетов)

**Files:**
- Create: `app/scripts/seed-phase1.ts`, `app/tests/seed-phase1.test.ts`

**Interfaces:**
- Consumes: те же helpers, что и API (get-or-create, axesToTagNames).
- Produces: продукты ТКМ/ЖИВО/СУСТАВЫ; новый АВ-тег-подрядчик `FAQ`; 6 воронок (num 33–38) по таблице ниже; теги проставлены; funnel_days НЕ создаются (скелет).

| num | front_code | product | contractor | channel | direction | source | status |
|---|---|---|---|---|---|---|---|
| 33 | f32 | СУСТАВЫ | НИМБ | Яндекс | РСЯ | Яндекс РСЯ | active |
| 34 | f33 | ЖИВО | НИМБ | Яндекс | РСЯ | Яндекс РСЯ | active |
| 35 | f34 | ТКМ | НИМБ | Яндекс | РСЯ | Яндекс РСЯ | draft |
| 36 | f27 | ЖИВО | NR | ВК | Реклама | ВК NR | active |
| 37 | f29 | СВС | НИМБ | ВК | Реклама | ВК НИМБ (создать) | active |
| 38 | f30 | ДЫХАНИЕ | FAQ | ВК | Реклама | ВК FAQ (создать) | active |

- [ ] **Step 1: Тест** (временная копия БД): после сидирования `SELECT COUNT(*) FROM funnels` = 38; продукт ТКМ существует; у num35 `status='draft'`; reg-теги num36 содержат `АВ Продукт: ЖИВО`, `АВ Подрядчик: NR`.

- [ ] **Step 2: Запустить — упадёт.** Run: `npx vitest run tests/seed-phase1.test.ts`. Expected: FAIL.

- [ ] **Step 3: Реализовать `seed-phase1.ts`** (идемпотентно: пропускать существующий num).

- [ ] **Step 4: Тест проходит**, затем выполнить против реальной БД (после бэкапа). Expected: 6 новых воронок в `/`.

- [ ] **Step 5: Commit** `feat(funnels-admin): phase-1 seed (3 products + 6 funnels)`.

---

### Task 11: Docker + Dokploy

**Files:**
- Create: `app/Dockerfile`, `app/.dockerignore`, обновить `app/next.config.ts` (`output: 'standalone'`), `app/.env.example`

**Interfaces:**
- Produces: образ, который Dokploy собирает из Git; БД-файл — на volume по `FUNNELS_DB_PATH`.

- [ ] **Step 1: `next.config.ts` → `output: 'standalone'`.**

- [ ] **Step 2: Multi-stage Dockerfile** (build → runner на node:20-slim, `better-sqlite3` требует сборки; убедиться, что нативный модуль компилируется). EXPOSE 3000, `CMD ["node","server.js"]`.

- [ ] **Step 3: `.env.example`** с `FUNNELS_DB_PATH=/data/ksamata_funnels.db`. В README-заметке описать: в Dokploy примонтировать volume на `/data`, положить туда стартовую копию БД.

- [ ] **Step 4: Локальная сборка образа** `docker build -t funnels-admin app/` — успешно.

- [ ] **Step 5: Commit** `feat(funnels-admin): Dockerfile + Dokploy volume config`.

---

## Self-Review

**Spec coverage:**
- §2 стек/деплой → Task 1, 11. §3 схема (status/front_code) → Task 2, 3. §4 объём (CRUD, справочники) → Task 6, 7, 9. §5 архитектура (db/api/components/lib) → все. §6 поток данных → Task 7, 9. §7 ошибки → Task 5 (валидация), Task 7 (транзакции/409). §8 тесты → Task 4–7, 10. §9 наполнение → Task 10. §10 критерии готовности → совокупно Task 9–11.
- Гэп: §7 «запрет удаления справочного значения, на которое ссылается воронка» — добавить как шаг в Task 6 (POST/DELETE refs): DELETE ref → проверка ссылок, иначе 409. *(учтено: расширить Task 6 проверкой при удалении, если потребуется DELETE; для Фазы 1 справочники только добавляются — удаление можно отложить, зафиксировано здесь.)*

**Placeholder scan:** код-логика (ab-tags, validation, seed) дана конкретно; UI-вёрстка описана через макет (визуальная задача, не псевдокод).

**Type consistency:** `AbAxes`, `axesToTagNames`/`tagNamesToAxes`, zod-схемы — имена согласованы между Task 4/5/7/10.

**Открытый вопрос (не блокирует):** починка `num16` — отдельной задачей после Фазы 1.
