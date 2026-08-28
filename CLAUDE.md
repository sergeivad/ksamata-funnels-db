# CLAUDE.md

Canonical guide for AI agents (Claude Code, Codex) and humans working in this repo.
This is the single source of truth for architecture, commands, and conventions.
Keep it in sync when you change structure, migrations, env vars, or the data model.

## What this is

**Ksamata Funnels DB** — an internal service for collecting, normalizing, and
editing Ksamata autofunnel data through an admin web UI. The system of record is
a single SQLite database (`ksamata_funnels.db`); the `app/` Next.js service is
the production boundary that reads and edits it. Python tools under `tools/`
build and export the same database from Excel sources.

## Repository layout

| Path | Purpose |
|---|---|
| `app/` | **Production service** — Next.js 15 admin app (App Router), API routes, Drizzle schema, migrations, tests, Docker files. Treat as the service boundary. |
| `ksamata_funnels.db` | Live local SQLite database. Kept at repo root (tests, Python tools, and Docker seed refresh all assume this path). |
| `app/seed/ksamata_funnels.db` | Seed database baked into the production Docker image. |
| `data/source/` | Source Excel workbooks used to build/enrich the DB. |
| `data/generated/` | Generated workbook exports (gitignored). |
| `tools/data-import/` | Python scripts that build or mutate the root SQLite DB. |
| `tools/data-export/` | Python scripts that export the DB to XLSX reports. |
| `tools/audit/` | Tag drift map: reconciles the GetCourse offer registry, `deal_export` history, and the DB. Read-only; output is an XLSX in `data/generated/`. See [tools/audit/README.md](tools/audit/README.md). |
| `tools/reconcile/` | **Сверка источников по воронкам** — база ↔ таблица маркетологов ↔ выгрузка заказов, в один markdown-отчёт по этапам разбора. Read-only. **Начинать с него любую сессию по сверке данных.** См. [tools/reconcile/README.md](tools/reconcile/README.md) и [порядок разбора](docs/plans/2026-08-04-razbor-design.md). |
| `tools/sheet-links/` | **Ссылки воронок из таблицы «Воронки ссылки»** — сверка гугл-таблицы маркетологов с блоками воронки. Сейчас собирает `tariffs`/`applications`/`upsell`; колонка продажной страницы делится по хосту (`t.ksamata.ru` → тарифы, `gc.ksamata.ru` → допродажи/дожим). Read-only, отчёт в `data/generated/`, план заливки — флагом `--plan`. **Колонки ищутся по названию: раскладка листов различается, жёсткие номера верны лишь для 19 из 26.** См. [tools/sheet-links/README.md](tools/sheet-links/README.md) и **[карту источника](docs/sheet-links-source-map.md) — с неё начинать любую новую сборку ссылок из этой таблицы**. |
| `docs/` | Development notes, project map, docs index, and historical plans/specs. See [docs/README.md](docs/README.md). |

`ksamata-leak-funnels/` (local reference dataset) and `*.db.bak_*` backups are
gitignored and never committed.

## App commands

Run everything from `app/`:

```sh
npm install
npm run dev          # next dev on :3000
npx tsc --noEmit     # typecheck
npx vitest run       # full test suite
npm run lint         # eslint (.eslintrc.json); `next lint` is deprecated in Next 16
npm run build        # production build
```

One test file, or one case inside it — the suite is ~75 files, so a targeted
change does not need the whole run:

```sh
npx vitest run tests/monitor-run.test.ts
npx vitest run tests/monitor-run.test.ts -t 'ретеншен'
```

`-t` matches the `describe`/`it` text, and **test names in this repo are
Russian** — an English filter silently selects nothing and still exits 0.

The dev server uses `FUNNELS_DB_PATH` when set; otherwise it defaults to the
repo-root database resolved in `app/src/db/client.ts` (relative to `process.cwd()`,
which is `app/`).

Python tool tests run from the **repo root**, one suite per tool:

```sh
python3 -m pytest tools/audit/tests
python3 -m pytest tools/data-import/tests
python3 -m pytest tools/data-export/tests
python3 -m pytest tools/reconcile/tests
python3 -m pytest tools/sheet-links/tests
```

## Data model (`app/src/db/schema.ts`)

Drizzle SQLite. Core + lookup + content + tags tables:

- **Lookups:** `sources`, `products`, `contractors`, `funnel_types` (funnel-type
  marker, `{id, name}` — `name` holds the GetCourse marker text verbatim, e.g.
  `АВ Автоворонка`/`АВ Прямые`/`АВ Квиз`/`АВ Квиз-Лайт`), `tags` (global tag names).
- **`funnels`** — one row per funnel: identity FKs (source/product/contractor),
  nullable `funnelTypeId` FK into `funnel_types` (`NULL` = type not chosen, no
  marker emitted at all — same rule as an empty axis), `variant`, `productName`,
  dashboard URLs, raw tag strings (`tag19Raw`/`tag15Raw`/`regTagsRaw`),
  `roomIdsJson`, `bothelpCondition`, `status` (`active`/`draft`/`archive`),
  `frontCode`, `comment`, `timeLabelA`/`timeLabelB`, and room toggles
  `roomsEnabled` / `roomsReplayEnabled`.
  Семи URL-колонок дашбордов (`dash_sales_url`, `dash_pereliv_url`,
  `regi_total_url`, `regi_15_url`, `regi_19_url`, `regi_notime_url`,
  `predspisok_url`) в `schema.ts` больше нет (Phase 11) — как и `landing_url`
  (Phase 10). Колонки остались в SQLite пустыми, потому что в них пишет
  Python-импорт; адреса живут в блоках `links` и `landings`.
  **`num` and `frontCode` are two unrelated numberings** — `num` is the internal
  key (unique, never shown to a human), `frontCode` is the F code the funnel is
  called by everywhere else and it comes from LeakEngine, not from here. They
  coincided on 16 funnels out of the 66 that have a code, so anything that
  derives one from the other is a bug; see `front-code.ts` below.
- **`funnel_days`** — per-funnel day × time-slot rows (`timeSlot` `19`/`15`,
  `dayNum`) with room fields and legacy content columns. The room a row points
  at is `gc_room` / `web_room`; **`room_id_f1` is dead** — the whole repo
  touches it in exactly two places, the Drizzle declaration and four Python
  import scripts that *write* it. Nothing reads it: not the app, not the
  export, not monitoring, not the UI. `DayCell` has no such field, so
  `replaceDays` (delete + reinsert) **blanks it on every grid edit** — which is
  why only 240 of 508 rows still carry a value. Do not build on it, and do not
  "fix" it in isolation: the drift found in `f25`/`f26` on 2026-08-02 was two
  years stale and invisible to every consumer.
- **`funnel_blocks`** / **`funnel_block_items`** — structured content blocks
  (see block kinds below); a block has a `kind`, `enabled`, and `mode`
  (`common` / `by_time`); items carry `slot`, `label`, `url`, `position`.
- **Tags system (see below):** `funnel_tags` (resolved per-funnel tags),
  `tag_templates` (global template per scenario), `funnel_tag_overrides`
  (per-funnel add/remove deltas).
- **Other:** `salebot_configs`, `product_durations`.
- **Monitoring (Phase 6):** `monitor_targets` (URL to check, `source_kind`,
  `enabled`, plus `manual_override` — set to `1` only when `setTargetEnabled`
  requests an `enabled` value that differs from **the group's default**;
  requesting the default clears it back to `0`. So `manual_override = 1` reads
  as "this one target differs from its group". `manual_override = 1` makes the
  sync leave `enabled` alone; while it is `0` the sync recomputes `enabled`
  from the group default, so a landing that briefly vanished from the funnel
  data comes back on by itself),
  `monitor_source_kind_prefs` (the human's decision for a whole `source_kind`,
  written by `setSourceKindEnabled` — this is what makes a URL added to a
  block **later** inherit the group and start being checked without anyone
  clicking; no row = fall back to "landings on, everything else off"
  (`LANDING_SOURCE_KIND`). A group
  click also clears `manual_override` across the group: the group decision
  beats per-target toggles inside it),
  `monitor_target_funnels` (which funnels use the URL),
  `monitor_state` (current status per target, 1:1), `monitor_events` (status
  **changes** only — never one row per check).
- **Orphaned/inactive:** `channels`, `directions` (present in schema but not
  exposed via `/api/refs`), and `funnel_links` (removed — links are now a
  `funnel_blocks` kind). Do not build on these without checking.

**Block kinds** (`app/src/lib/blocks.ts`, canonical slugs): `landings`,
`records`, `tariffs`, `applications`, `bonuses`, `oto`, `processes`,
`upsell`, `links`.

`upsell` («Допродажи / дожим») до Phase 13 назывался `meditation` — слаг остался
от первой версии карточки и обещал не то содержимое, которое в блок кладут.
Не спутать с `funnel_days.meditation`: это **другая** сущность, легаси-колонка,
в которую до сих пор пишет Python-импорт, и её Phase 13 не трогает.

### Tags: three layers

Tags are resolved, not stored once. Understand the layering before editing:

1. **`tag_templates`** — the global A/B template per scenario (`reg`, `time_15`,
   `time_19`, `messenger`, `predspisok`). Edited at `/tags`.
2. **`funnel_tag_overrides`** — per-funnel `add`/`remove` deltas layered on top
   of the template. Edited on the funnel page.
3. **`funnel_tags`** — the materialized result (template + overrides), computed
   by `app/src/lib/ab-tags.ts` (`computeTagSet`) and written on funnel
   create/update. Read-only output; never hand-edit.

Raw tag strings on `funnels` (`*Raw`) are import/export artifacts, not the
source of truth. **Always mutate tags through `createFunnel`/`updateFunnel`
(tsx) or the API, never with raw SQL.**

Поверх трёх слоёв лежит **слой идентичности**: четыре осевых тега
(`АВ Продукт:` и три остальных) и **маркер типа воронки** — пятая ось,
выводимая из `funnels.funnel_type_id` (справочник `funnel_types`,
`app/src/lib/funnel-type.ts`). Теги идентичности нельзя ни удалить
оверрайдом, ни положить в шаблон: `computeTagSet` гасит их в обоих слоях.
Значения типа расширяемы через `/refs` — набор маркеров задаёт GetCourse.

**Время — свойство типа, а не сценария** (Phase 12). У типа с
`funnel_types.has_time = 0` (`АВ Прямые`, `АВ Квиз`, `АВ Квиз-Лайт`)
`computeTagSet` снимает все теги `АВ Время: …` — и из шаблона, и из
`add`-оверрайдов. В `suppressed` они не попадают: скрытый дефолт — решение
человека, отменяемое кликом, а здесь тега нет по свойству типа, и вернуть его
можно только галкой «эфиры» в `/refs` (она же пересобирает теги всех воронок
этого типа, см. `setFunnelTypeHasTime` в `funnels.ts`). Тип не выбран
(`funnel_type_id IS NULL`) — время **остаётся**: это «не решили», а не
«времени нет».
Сценариев оплаты в схеме по-прежнему два, и у безвременной воронки они
материализуются одинаковыми; карточка показывает одну вкладку «Оплата»
(`FunnelDetail.typeHasTime`, `app/src/lib/tag-scenarios.ts`), а
`applyTagOverrides` зеркалит правку оплаты в оба сценария, чтобы две строки
оверрайдов не разъехались (`mirrorPaymentOverrides`: главным считается
изменившийся сценарий, при правке обоих — `time_19`, который правит интерфейс).
В реестре GetCourse значений времени **четыре** (`15`, `19`, `17`, `20`), и
часть предложений несёт сразу два — у нас зашиты только 15 и 19; расхождение
известное, отдельная тема.

**Сценариев пять** (Phase 14, 25.08.2026): пятый — `predspisok`, и устроен он
как `messenger`, а не как пара оплат: одна строка шаблона, ни тега времени, ни
зеркалирования, ни своей raw-колонки (их три, не четыре, и у мессенджера её
тоже нет). Машинерия пары `time_15`/`time_19` его не касается вовсе.
Набор получают **все** воронки — сценарий часть модели, а не свойство воронки;
предложения этого этапа в GetCourse заведены у 16 из 76, и это расхождение
разбирает аудит, а не схема.

**Тег пишется `АВ Этап: Предписок`, без «с».** Это опечатка GetCourse, и
повторять её обязательно: наборы сравниваются с реестром предложений дословно,
а исправление написания у себя развело бы базу со всеми живыми предложениями
этапа. Человеческая подпись строки при этом — «Предсписок», через «с»
(`scenarioViews` в `tag-scenarios.ts`): подпись называет шаг воронки, тег
повторяет реестр. Легаси-тег `предсписок` — **третья**, посторонняя сущность:
другой тег, автоматически ни к чему не сводится. Одна строка написания живёт в
двух местах, на двух языках — `PHASE14_STAGE_TAG`
([app/scripts/migrate-phase14-data.ts](app/scripts/migrate-phase14-data.ts)) и
`PREDPISOK_STAGE` ([tools/audit/normalize.py](tools/audit/normalize.py));
править обе.

## Domain helpers (`app/src/lib/`)

- `funnels.ts` — funnel CRUD + business logic (list/get/create/draft/update/
  delete/duplicate, tag resync, `applyTagOverrides`, `resyncAllFunnels`).
  A `num` collision always surfaces as `ConflictError` → 409, whether the
  pre-check catches it or another writer of the same DB file (a Python tool, a
  second instance) takes the number between that check and the INSERT — the
  transaction is wrapped in `asNumConflict`. A taken `frontCode` behaves the
  same way (`asFrontCodeConflict` → 409, message naming the owning funnel),
  except that an **empty** code never conflicts — a funnel without an F code is
  a legitimate state, and a dozen live rows are in it. Where a number is
  allocated rather than given (`createDraftFunnel`, `duplicateFunnel`), the
  wrapper is `withAllocRetry` instead: recomputing MAX+1 is the right answer
  there, for `num` and for the F code alike, while a user-specified value must
  fail rather than silently become a different one.
  `resyncAllFunnels` **skips funnels whose four axes are all empty** — that is a
  blank draft, and `createDraftFunnel` leaves it without AV tags on purpose.
  Materializing the template into it would make a draft's contents depend on
  whether someone edited the global template between its creation and its
  first save.
- `refs.ts` — lookup-table CRUD + usage counting (`TABLE_MAP`, `VALID_KINDS`),
  plus `IMMUTABLE_KINDS` / `isImmutableKind`: `tags` is read-only through the
  refs API for **every** method. `POST` used to be open while `PATCH`/`DELETE`
  were blocked, so a tag created by hand could never be removed through the API.
  Tags are owned by the template/override engine.
- `funnel-days.ts` — read/replace `funnel_days`. `replaceDays` also flips
  `funnels.rooms_enabled` **on** when it writes at least one non-empty room.
  That flag is a display switch, not a row count: while it is `0` the funnel
  card, the compact view **and `buildExportRows`** all skip the rooms. It used
  to be set by exactly two places — the Phase-4 backfill and `RoomsEditor`
  (which PATCHes it right after PUTting days) — so every writer that isn't the
  admin UI (the Python import scripts, one-off tsx) left the rooms invisible.
  Six funnels and 52 rooms, a tenth of all of them, drifted that way. The flip
  only ever goes **up** and only on a non-empty write: clearing the grid is a
  legitimate operation and must not read as "enable", and a human's decision
  that a funnel holds no webinars must not be undone silently.
- `funnel-blocks.ts` — read/replace blocks and items.
- `blocks.ts` — static block-kind registry.
- `block-fill.ts` — block-editing helpers (parse pasted lines, mirror slots, labels).
- `room-urls.ts` — правила адресов вебинарных комнат: `webRoomFromGc`,
  `mirrorDayUrl`, `mirrorSlotRoomUrl`. Слотовое зеркало знает **две** семьи
  слагов, и это не украшение: половина воронок несёт время в адресе
  (`dbo1-15-vks` ↔ `dbo1-19-vks`), у другой половины времени в адресе нет
  вовсе и второе время получается перестановкой цифры дня через первое слово
  (`1dbo-bookv` ↔ `dbo1-bookv`). Замер по живой базе: 151 + 113, третьего
  случая нет. Не путать с `mirrorSlotUrl` из `block-fill.ts` — тот правит
  подписи и произвольные URL блоков заменой токена `15` и семьи B не знает;
  перестановка цифры дня в подписи блока дала бы мусор.
- `url-field.ts` — hygiene of a block item's URL field, shared by `BlockEditor`/
  `BlockListField` and the blocks `PUT` route. Two classes: **A** — a label glued
  into an http(s) URL (`…/a (ADS)`, a trailing quote) is rejected, because
  `normalizeUrl` percent-encodes it instead of dropping it and monitoring then
  tracks a permanently-404 ghost target; **B** — plain text in the URL field
  (`сайты`, `геткурс`) only warns: such notes predate the field and create no
  targets. Never make class B blocking without cleaning the data first.
- `front-code.ts` — everything about the F code: `normalizeFrontCode` (trim +
  lowercase — SQLite compares TEXT bytewise, so `F80` and `f80` would otherwise
  slip past the unique index as two rows), `frontCodeNum`, `nextFrontCode`,
  `funnelRefLabel`. Pure, no DB — the caller queries. `nextFrontCode` is
  `max(F) + 1`, **not** the first gap: gaps (`f1`–`f5`, `f10`, `f14`, `f17`,
  `f18`, `f20`, `f44`, `f49`, `f65`, `f71`, `f72`, `f75`, `f76`, `f77`) are
  numbers LeakEngine can hand out at any moment. It is also
  not derived from `num`: `createDraftFunnel` used to write `f${num}`, and with
  `max(num)=75` against `max(F)=79` the next two drafts would have taken `f76`
  and the **already-occupied** `f77`. Since 2026-08-04 this base **allocates**
  the code rather than borrowing it — the owner then carries it into LeakEngine
  (see [docs/leak-engine.md](docs/leak-engine.md)). The suggestion stays
  editable: LeakEngine may already hold a higher number.
  `parseFunnelRef` разбирает сегмент адреса (`f86` → код, `86` → id, прочее →
  404), `funnelRefSegment` строит этот сегмент без префикса `/funnels/`, а
  `funnelHref` собирает полный путь через него. Различение по букве, а не по
  эвристике: код воронки и чужой `id` совпадают сплошь и рядом — у F37 `id`
  равен 1, а `id` 37 принадлежит другой воронке.
- `tag-scenarios.ts` — порядок и подписи сценариев тегов на все экраны
  (`scenarioViews`, `joinTagsForCopy`). У безвременной воронки строк четыре, и
  оплата берётся от `time_19`. Вынесено из компонентов, чтобы «Оплата 15:00»
  в просмотре и в редакторе не разошлись словами. Здесь же живёт подпись
  «Предсписок» — через «с», в отличие от самого тега (см. раздел про теги).
- `funnel-search.ts` — видимость строки в списке: поиск по имени и F-коду плюс
  вкладка статуса, условия перемножаются (`isFunnelVisible`). По всем воронкам
  поиск идёт не потому, что функция игнорирует вкладку, а потому, что список
  сам встаёт на «Все» при первом нажатии в поле (`handleSearchChange` в
  `app/src/app/page.tsx`, переключение только на переходе «пусто → запрос»).
  Так вкладка не врёт: раньше она игнорировалась на время поиска и стояла
  «Активные», пока в выдаче лежал архив. Раздел, выбранный уже поверх запроса,
  сужает выдачу — это решение человека, и отменять его нельзя.
  Сама вкладка **«Все» показывает все три статуса, включая архив**
  (`matchesStatusFilter` в `status.ts`): пока она прятала архив, счётчик писал
  «54 из 75» на разделе, который называется «Все».
- `funnel-sort.ts` — list order by F (`compareByFrontCodeDesc`) plus
  `compareByFrontCodeAsc` for the monitoring chip rows. Codeless funnels go
  **last in both**: that is a property of having no code, not of the direction,
  so Asc is not a mirror of Desc.
- `ab-tags.ts` — A/B tag computation engine (axes ↔ names, `computeTagSet`).
- `tag-templates.ts` / `tag-overrides.ts` — read/replace the two tag layers.
- `status.ts` — funnel status constants/meta (active/draft/archive).
- `auth.ts` — чистое ядро авторизации (учётки, подпись сессии, `resolveAccess`),
  Edge-безопасное; `auth-server.ts` — обвязка на Node (`getViewer`,
  `requireEditor`, оба через общий `resolveAccessFrom`); `login-attempts.ts` —
  счётчик неудачных попыток на `globalThis`, Edge-безопасный, потому что его
  зовут с обеих сторон. Подробно — раздел Auth ниже.
- `link-preview.ts` — `isLinkPreviewBot(userAgent)`: опознание ботов, которые
  рисуют карточку предпросмотра ссылки в мессенджерах. Мидлвара отвечает им
  `204` без тела на GET/HEAD, и ссылка на сервис приходит в переписку голой
  строкой — решение владельца 2026-08-13. `robots.txt` тут не рычаг:
  `Disallow: /` у сервиса стоял и до этого, а превью всё равно рисовалось —
  боты предпросмотра ходят не как поисковый краулер и robots.txt не читают.
  Убрать мета-описание тоже мало: карточка осталась бы, просто пустее. Это
  **не** защита: `User-Agent` подделывается одной строкой, а страницы за этим
  ответом и так читаются анонимно; поэтому же ветка ловит только GET/HEAD —
  решения о записи принимает авторизация, а не заголовок.
- `rooms-grid.ts` — build/flatten the rooms grid (slot × day).
  Там же `fillRoomGrid` — достройка пустых ячеек по образцу заполненных
  (кнопка «Заполнить остальные»). Источник ищется сначала в своём слоте, где
  хватает дневного зеркала, и только потом в чужом. **Повтор выводится
  только по дням своего слота:** правила, связывающего повтор с комнатой,
  в данных нет — «вставить `r` после цифры дня» верно в 38 случаях из 44.
- `funnel-compact.ts` — grouping/visibility for the compact view.
- `export.ts` — build export rows + CSV serialization. Fields starting with
  `=`, `+`, `-`, `@`, TAB or CR get a leading apostrophe: the route serves a BOM
  and `;` so Excel opens the file, and Excel executes such a cell on open.
  RFC 4180 quoting does not prevent that — it strips the quotes and evaluates.
- `validation.ts` — Zod schemas + `parseRouteId`. `landingUrl` accepts `''` or
  an **http(s)** URL up to `URL_MAX` (4096) — `new URL()` alone happily accepts
  `javascript:` and `data:`. The cap is 4096 rather than the customary 2000
  because the live DB holds a genuine 2019-character GetCourse segment link.
- `http.ts` / `errors.ts` — response/error helpers.
- `clipboard.ts` / `useUnsavedGuard.ts` — client hooks.
- `monitor-status.ts` — monitoring status values, badge metadata, `formatAgo`.
- `monitor-urls.ts` — URL normalization + multi-URL field splitting. A checkable
  target is http(s), has a dotted hostname (no IP literals) and a standard port —
  otherwise the dashboard becomes an SSRF oracle and a port scanner for the
  container's own network. `resolveRedirectTarget` applies the very same rule to
  each redirect hop; keep the two in one place, a hop that skips the check
  reopens the whole hole.
- `monitor-targets.ts` — sync targets from funnel data, enable/disable, group defaults.
  Only funnels with `status = 'active'` are collected (`MONITORED_FUNNEL_STATUS`);
  drafts and archive are out of scope, and a URL left behind by a funnel leaving
  `active` goes through the normal retirement path (muted, unlinked, history kept,
  auto-revived when the funnel comes back) — **unless** `manual_override = 1`,
  in which case retirement unlinks it but leaves `enabled` alone, same as the
  live branch. Muting an overridden target would strand it: the override stays
  set, so the live branch would then refuse to recompute `enabled` and the
  returning URL would never come back on. Exports `collectFunnelUrls` so the
  dashboard can collect URLs of **non**-active funnels through the very same
  normalization. The retirement branch touches only targets that are still
  `enabled = 1`, so `retired` counts what this run actually muted and the
  `updatedAt` of a long-retired target is not rewritten by every sync —
  otherwise the stamp could never tell you when a target actually dropped out.
- `monitor-kinds.ts` — Russian labels for source kinds (reuses `BLOCK_KINDS`
  titles) + `sourceKindTone`, which decides how a group chip reads: any group
  with at least one checked target is orange (`on`/`partial`), only a fully
  disabled one is grey. `partial` differs from `on` in wording and
  `aria-pressed="mixed"`, not in colour — a partially enabled group must not
  look switched off.
- `monitor-check.ts` — pure HTTP availability check (`checkUrl`). Follows
  redirects itself (`redirect: 'manual'`, ≤ `MAX_REDIRECTS`), validating every
  hop through `resolveRedirectTarget`; a refused hop reports a generic error and
  never echoes the destination back to the dashboard. One `AbortSignal.timeout`
  covers the whole chain, so N hops cannot stretch into N timeouts.
  **Before every connection — including each redirect hop — the hostname is
  resolved and every returned address checked** (`lookupImpl`, default
  `resolveHostAddresses`). A hostname is a promise, not an address:
  `10.0.0.5.nip.io` passes `normalizeUrl` (dotted name, no literal) and lands in
  the private network, so the literal filter alone is not a defence. A refused
  host reports the same generic "внутренняя сеть" error — never the IP.
  `dns.lookup` ignores `AbortSignal`, so the lookup gets its own budget equal to
  `timeoutMs`; without it a hung resolver would hold a cycle worker for as long
  as the system `getaddrinfo` felt like. Residual risk, accepted knowingly: the
  connection re-resolves, so an attacker controlling DNS with a very short TTL
  could still rebind between check and connect. Closing that needs pinning the
  connection to the vetted IP (a custom `undici` dispatcher, a new dependency).
- `monitor-dns.ts` — pure address classifier (`isPrivateAddress`) + the
  `LookupFn` type. Fails closed: an address it cannot parse counts as private.
  Understands IPv4 embedded in IPv6 (`::ffff:127.0.0.1`, NAT64, 6to4), because
  the wrapper form is exactly how a loopback address sneaks past a naive check.
  No network here — that is why it is testable and stays in the edge bundle.
- `monitor-resolver.ts` — the real `node:dns` lookup, alone in its own file.
  It is the second Node-only leaf after `db/client.ts`, and `next.config.ts`
  aliases it away for the edge build (see below). Keep it that way: put
  anything checkable-without-network in `monitor-dns.ts` instead.
- `monitor-run.ts` — check cycle, state persistence, event log. The cycle ends
  with `pruneEvents`: `monitor_events` older than `EVENT_RETENTION_DAYS` (90)
  are dropped. Events are written only on a **change** of status, but a flapping
  target still produces ~190 rows a day and there are ~600 targets, so without a
  bound the table never stops growing. Pruning rides the cycle because the cycle
  is the table's only writer — no separate cleanup schedule to forget about.
- `monitor-view.ts` — dashboard read models. Group counters (`sourceKinds`) count
  **only pages of active funnels**: archiving a funnel is itself the decision that
  its pages leave monitoring, so they drop out of the denominator, as do orphaned
  URLs — otherwise "41 из 45" implies four broken pages that no longer exist. A
  target that a human enabled by hand still counts, so `enabled` can never exceed
  `total`. Each target also carries `usage` — `active` / `inactive` (held only by
  a draft/archive funnel) / `orphan` (held by nobody) — used **only** to explain
  in the table why a row is off. `inactive` vs `orphan` is resolved by
  re-collecting funnel URLs for non-active statuses via `collectFunnelUrls`
  (same normalization as the sync), not from a stored column.
- `monitor-scheduler.ts` — env config + `setInterval` (started by `src/instrumentation.ts`).

## API routes (`app/src/app/api/`)

- `GET/POST /api/funnels` — list / create.
- `POST /api/funnels/draft` — create empty draft.
- `GET/PATCH/DELETE /api/funnels/[id]` — detail / update (incl. status/archive
  and rooms toggles) / delete.
- `POST /api/funnels/[id]/duplicate` — duplicate.
- `GET/PUT /api/funnels/[id]/days` — read/replace days. A true replace within the
  funnel: a day absent from the payload is deleted, so callers send the whole grid.
- `GET/PUT /api/funnels/[id]/blocks/[kind]` — read/replace one block kind.
- `PATCH /api/funnels/[id]/tags` — apply per-funnel tag overrides. Genuinely
  partial: a scenario the body omits keeps its stored overrides; clear one by
  naming it with empty `add`/`remove`.
- `GET/POST /api/refs/[kind]` and `PATCH/DELETE /api/refs/[kind]/[id]` — refs CRUD.
  `PATCH` принимает две разные формы тела: `{ value }` — переименование,
  `{ hasTime }` — признак «эфиры по времени» и **только для `funnel_types`**
  (у прочих видов 400). Вторая форма пересобирает теги всех воронок этого типа
  и отвечает `{ id, hasTime, resynced }`.
- `GET /api/tag-templates` and `PUT /api/tag-templates/[scenario]` — global template.
- `GET /api/export` — CSV export of all funnels.
- `GET /api/monitoring` — summary + targets with state.
- `POST /api/monitoring/run` — start a check cycle. Returns **202** as soon as
  the cycle has started (it is not awaited — a wide scope can take tens of
  minutes and any proxy would cut the request); 409 if one is already running.
  Poll `GET /api/monitoring` and watch `summary.running` for completion.
- `PATCH /api/monitoring/targets` — bulk enable/disable by `sourceKind`.
- `PATCH /api/monitoring/targets/[id]` — enable/disable one target.
- `GET /api/monitoring/events` — incident history.
- `POST /api/auth/login` — вход: пара имя/пароль → cookie сессии. Ответ на
  неверные данные один и тот же независимо от того, существует ли имя (иначе
  форма перечисляет учётки); 429 после `LOGIN_MAX_ATTEMPTS` неудач с одного
  адреса — счётчик живёт на `globalThis`, см. правило про синглтоны.
- `POST /api/auth/logout` — гасит cookie.

Все мутирующие роуты и GET приватных начинаются с `requireEditor(req)` —
второй рубеж, см. раздел Auth.

Rooms and status have **no dedicated endpoints** — they persist through the
funnel `PATCH` and the days `PUT`.

## Pages & components

Pages (`app/src/app/`): `page.tsx` (funnel list), `funnels/[ref]/page.tsx`
(edit; сегмент — F-код либо id), `tags/page.tsx` (global template editor),
`refs/page.tsx` (lookup tables), `monitoring/page.tsx` (landing-availability
dashboard),
`login/page.tsx` (вход редактора), `help/page.tsx` (справка по сервису).
`/refs`, `/tags` и `/monitoring` закрыты серверным `EditorGate` через свои
`layout.tsx`.

`help/page.tsx` — статический серверный компонент: ни клиентского JS, ни
обращений к БД, ни `EditorGate`, а сам путь занесён в `PUBLIC_GET_PATTERNS`.
Всё это одно решение: справку кидают ссылкой тому, у кого учётки ещё нет.
Скриншоты — `app/public/help/*.webp`, выноски к ним рисуются **поверх картинки
в HTML** (компонент `Shot`), а не вжигаются в неё: подписи тогда правятся
текстом и читаются скринридером. Рецепт пересъёмки — в спеке.
Правило по содержанию — **интерфейс и правила, но не текущие данные**: числа
вроде «73 воронки» устаревают за неделю и делают недостоверной всю страницу
(ровно судьба `docs/OPEN.md`). Спека —
[2026-08-04-help-page-design.md](docs/superpowers/specs/2026-08-04-help-page-design.md).

Components (`app/src/components/`): `AppHeader`, `FunnelCard`,
`FunnelCompactView`, `FunnelIdentity`, `FunnelSections`, `BlockEditor`,
`BlockListField`, `RoomsEditor`, `TagTemplateEditor`, `RefSelect`/`RefTable`,
`AuthProvider` (контекст прав + `useCanEdit`), `EditorGate`, `LoginForm`,
plus UI primitives (`StatusPill`, `CodeChip`, `Segmented`, `Switch`,
`GroupToggle`, `UrlInput`, `Toast` — у первых четырёх есть `disabled`/
`readOnly` для режима просмотра). `monitoring/` (`MonitorStatusPill`,
`MonitorSummary`, `MonitorTable`, `MonitorEvents`) backs the monitoring page.

## Database contract & WAL

`ksamata_funnels.db` stays at the repo root. Keeping it here is intentional:
tests copy `../../ksamata_funnels.db` into a temp fixture, Python tools mutate
the root file, and the Docker seed refresh is based on it. Point elsewhere with
`FUNNELS_DB_PATH`.

**WAL gotcha:** SQLite keeps recent writes in `*.db-wal` while the dev server
runs. Before copying the DB to `app/seed/` or making a backup:

1. Stop the running app.
2. Checkpoint: `sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'`
3. Verify expected tables/counts against the main `.db`.

`*.db-wal` / `*.db-shm` sidecars and `*.db.bak_*` backups are gitignored.

**Monitoring gotcha:** the tracked DB's `monitor_*` tables are intentionally
**empty**. Running the dev server starts the background scheduler, which syncs
~600 targets and writes check results straight into that same tracked file. So
after any live run — `npm run dev`, a manual cycle, a browser check — restore it
before committing anything:

```sh
sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'
git checkout -- ksamata_funnels.db
rm -f ksamata_funnels.db-wal ksamata_funnels.db-shm
```

Verify with `sqlite3 ksamata_funnels.db "select count(*) from monitor_targets;"`
→ must print `0`, and `git status --porcelain` must be clean. Set
`MONITOR_ENABLED=false` in `.env.local` to keep the dev server from doing this
(and from hitting live landing pages) in the first place.

The monitoring tests no longer depend on that hygiene: every one of them wipes
the `monitor_*` tables of its own temp copy right after `runMigratePhase6`, via
`clearMonitoringState` in [app/tests/helpers/monitoring.ts](app/tests/helpers/monitoring.ts).
Those tables are the tests' own state, not source data, so clearing them is
correct — keep new monitoring tests on the same helper, and do not extend it to
funnel data (that stays as it is in the copied DB).

## Process state must be a real singleton

Module-level state is **not** a singleton in the production bundle. Because
`middleware.ts` runs on Edge, Next compiles `src/instrumentation.ts` with the
Edge compiler too, and webpack ends up emitting **separate module copies** for
the instrumentation graph and the API-route graph. Two copies means two
`let` variables and two `better-sqlite3` connections.

This is why `app/src/db/client.ts` (the DB handle) and `app/src/lib/monitor-run.ts`
(the in-flight cycle flag) park their state on typed `globalThis` slots. Before
the fix, the guard that stops the scheduler and the manual "check now" button
from running concurrent cycles silently did nothing in production.

**Unit tests cannot catch this** — vitest gives every importer the same module
instance, so a module-level flag looks perfectly correct under test. If you add
process-wide state (a cache, a lock, a connection, a queue), put it on
`globalThis` and verify against `.next/standalone`, not against the test suite.

**And `globalThis` only dedupes within ONE runtime.** Measured on
`.next/standalone/server.js`: five failed Basic attempts counted by
`middleware.ts` logged down to "осталось попыток 5", and the very next failure
for the same key through `POST /api/auth/login` (a Node route) logged "осталось
попыток 9" — it started from zero. The middleware runs in an isolated
edge-runtime context that does **not** share `globalThis` with the Node runtime
of API routes, even though both live in the same OS process. So a
`globalThis` slot is one store per runtime, not one per process: state that
must be shared across the Edge/Node boundary needs real external storage (the
DB, a KV), and code that keeps a counter or a lock on both sides has **two** of
them. `app/src/lib/login-attempts.ts` is deliberately in that position — see
the Auth section.

## Migrations (`app/scripts/`)

Migrations are phased and idempotent (guarded by schema markers or `IF NOT
EXISTS`). Each phase has a `migrate-phaseN.ts` (schema, used by tests + local
CLI), a `-data.ts` (shared DDL/seed), and a `-runner.ts` (standalone
better-sqlite3 runner compiled to `.cjs` for Docker).

- **Phase 2** — `channels`/`directions` tables + funnel columns.
- **Phase 3** — new funnel columns + `funnel_blocks`/`funnel_block_items`;
  `migrate-funnel-data.ts` moves legacy day/dashboard content into blocks once
  (marker `phase3_funnel_data`).
- **Phase 4** — `funnels.rooms_enabled` + smart backfill.
- **Phase 5** — `tag_templates` + `funnel_tag_overrides` + template seed,
  followed by `backfill-legacy-tag-overrides.ts` (preserves legacy non-AV tags
  as `add` overrides so Phase 5's resync doesn't drop them).
- **Phase 6** — monitoring tables (`monitor_targets`, `monitor_target_funnels`,
  `monitor_state`, `monitor_events`, `monitor_source_kind_prefs`).
- **Phase 7** — `funnels.front_code` becomes unique. The index is **partial**
  (`WHERE front_code IS NOT NULL AND front_code <> ''`): a plain UNIQUE would
  forbid the second codeless funnel and the migration would fail on the first
  real database. Before creating it the phase normalizes codes and **resolves
  any duplicates that already exist** — keeping the code on the lower `id`,
  blanking the rest and logging them. That branch is not decoration: the phase
  runs from `docker-entrypoint.sh` under `set -e`, so a failing `CREATE UNIQUE
  INDEX` would keep the container from starting at all. A duplicate is cleared,
  not renumbered — an invented code collides with a real LeakEngine one
  tomorrow, which is exactly how `f64`–`f72` happened.
- **Phase 8** — `funnel_types` (seeded with the four GetCourse markers) +
  `funnels.funnel_type_id`, plus a backfill of `АВ Автоворонка` onto every
  existing funnel. The backfill is not a decision about type — it preserves
  what the database already asserted (the marker was already hardcoded into
  every `tag_templates` scenario), so `funnel_tags` does not change by a
  single row; only where the marker comes from changes.
- **Phase 9** — merges the monitoring group `funnel_landing_url` into `landings`:
  a funnel's landing page is one thing whether its URL sits in the «Лендинги»
  block or in the card's `landing_url` field, and two chips counted the same
  page twice. Rewrites `monitor_targets.source_kind` and folds the two rows of
  `monitor_source_kind_prefs` into one — **"off" wins** when the two decisions
  disagree, because both groups are on by default, so "on" is usually just the
  default while "off" is a human deliberately removing pages from the board.
  The sync alone would not do it: it never writes `monitor_source_kind_prefs`,
  and with `MONITOR_ENABLED=false` it never runs at all. `updated_at` is left
  untouched — renaming a group says nothing about the target itself.
- **Phase 10** — the landing page of a funnel lives **only** in the «Лендинги»
  block. It used to sit in two places at once — `funnels.landing_url` and the
  block — and which one was true depended on who edited last: 25 active funnels
  held it only in the column, 20 in both. Only the block is editable in the UI;
  the column never had a field at all. The phase appends the column's addresses
  to the block (those not already there, comparing case- and trailing-slash-
  insensitively), enables the block it wrote into, then blanks the column — in
  one transaction, move first, so an interrupted run cannot lose an address. A
  column holding text rather than a URL is blanked too. **The phase stays in the
  chain forever**: the Python import tools still write `landing_url`, and every
  container start sweeps whatever landed there back into the block.
  `funnels.landing_url` is gone from `schema.ts`, from `FunnelDetail`, and from
  the create/update schemas — the column survives in SQLite, empty, and nothing
  in the app reads it.
- **Phase 11** — адреса дашбордов и подсчётов регистраций живут **только** в
  блоке «Ссылки». Семь колонок (`dash_sales_url`, `dash_pereliv_url`,
  `regi_total_url`, `regi_15_url`, `regi_19_url`, `regi_notime_url`,
  `predspisok_url`) держали то же, что и блок, но правит человек только блок:
  полей карточки у колонок нет, и приложение их не читает и не пишет. Фаза
  дописывает в блок адреса, которых там ещё нет (сравнение по адресу без учёта
  регистра и хвостового слэша, **подписи в сравнении не участвуют**), затем
  гасит все семь колонок — в одной транзакции, перенос первым. Понятия
  «конфликт» у неё поэтому нет: расхождение выглядит как «этого адреса в блоке
  нет» и дописывается вторым пунктом с той же подписью. Ничего не теряется, а
  лишний пункт человек снимает в админке; «блок главнее» стоило бы верных
  дашбордов f9 и f16, «колонка главнее» возвращало бы литералы Python-скриптов
  2022 года поверх правок маркетолога при каждом старте. **Фаза остаётся в
  цепочке навсегда**: колонки продолжает писать Python-импорт. Семь свойств
  удалены из `schema.ts`; сами колонки живут в SQLite пустыми.

- **Phase 12** — у типа воронки появляется признак «есть эфиры по времени»
  (`funnel_types.has_time`, по умолчанию 1; ноль у «АВ Прямые», «АВ Квиз»,
  «АВ Квиз-Лайт»). Тег «АВ Время: …» в реестре предложений GetCourse стоит
  **только на оплатах вебинарных воронок**: у «АВ Прямые» — на одном
  предложении из 71 (и то по ошибке), у квизов — ни на одном из 24. У нас же
  он приезжал из шаблона любой воронке, потому что зависел от сценария, а не
  от типа. Фаза заводит колонку, ставит нули **только в тот прогон, который
  колонку и завёл** (`NOT NULL DEFAULT 1` не отличает «ещё не решали» от
  «решили, что время есть», и безусловный бэкфилл затирал бы галку, снятую
  человеком в `/refs`), и **при каждом прогоне** снимает строки `funnel_tags`
  с тегом времени у воронок безвременных типов — 13 воронок, 26 строк.
  Прямая правка `funnel_tags` здесь законна: удаляются ровно те строки,
  которых `computeTagSet` теперь и не построит, что закреплено тестом
  «материализация после фазы даёт тот же набор».
- **Phase 13** — вид блока `meditation` переименован в `upsell` вслед за
  заголовком «Допродажи / дожим»: в блок кладут дожимные материалы и
  допродажи, а слаг обещал медитации. Наружу он не виден — и CSV-экспорт, и
  подписи групп мониторинга берут заголовок из `BLOCK_KINDS`, — так что фаза
  меняет только строки: `funnel_blocks.kind` (30 в репозиторной базе),
  `monitor_targets.source_kind` и `monitor_source_kind_prefs.source_kind`.
  Прямой `UPDATE`, а не пересоздание: на `id` цели висят `monitor_state` и
  `monitor_events`, и удаление со вставкой стёрло бы историю проверок; по той
  же причине `updated_at` не трогается. `funnel_blocks(funnel_id, kind)`
  уникален, поэтому воронка, где оба блока есть сразу, **пропускается и
  логируется**, а не роняет фазу: слить два блока автоматически нельзя (у
  каждого свои `enabled`, `mode` и пункты), а падение под `set -e` не пустило
  бы контейнер. Решение человека по группе переносится, только если под новым
  слагом его ещё нет — такая строка могла появиться лишь после переименования,
  то есть она свежее. После первого прогона фазе нечего делать (старый слаг
  никто больше не пишет: Phase 3 разбирает легаси-колонки один раз по маркеру
  и уже с новым слагом), но из цепочки её не убираем.
- **Phase 14** — пятый сценарий тегов `predspisok` («Предсписок»). Этап живёт в
  реестре GetCourse (16 предложений), а `tag_type` разрешал ровно четыре
  значения — наблюдения не привязывались ни к чему, чем и занимались классы 3 и
  6 отчёта аудита. **CHECK-ограничений при этом три, не одно** (`funnel_tags`,
  `tag_templates`, `funnel_tag_overrides`), и `PHASE5_DDL` расширить их не
  может: он `CREATE TABLE IF NOT EXISTS`, то есть на существующей базе не
  делает ничего. SQLite не умеет `ALTER` для CHECK, так что фаза перестраивает
  каждую таблицу — по идиоме `migrate-messenger-tagtype.ts`, но DDL не
  переписывает руками, а правит точечно текст из `sqlite_master`: колонки,
  внешние ключи и UNIQUE переезжают дословно. Дальше разовый сид строки шаблона
  за маркером `phase14_predspisok_seed` (не «вставить, если строк нет»: человек
  вправе очистить набор в `/tags`, и безусловный сид возвращал бы снятое при
  каждом старте контейнера) и **безусловная** материализация набора в
  `funnel_tags` — 456 строк на 76 воронок, ровно столько же, сколько у
  мессенджера. Прямая правка `funnel_tags` законна по доводу фазы 12: пишутся
  те и только те строки, которые построит движок, что закреплено тестом
  «материализация после фазы даёт тот же набор». Третий шаг
  самовосстанавливающийся, поэтому из цепочки фазу не убираем.

**Docker runs, in order** (`app/docker-entrypoint.sh`): Phase 2 → 3 (+data) →
4 → 5 → legacy-tag-override backfill → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14.

**A migration script must never run itself.** esbuild bundles the runner and the
migration into one file, and inside that bundle `require.main === module` is
true — so a CLI block in *any* bundled file fires on import and the phase body
executes twice per container start (once from the stray block, once from the
runner). That was the case from Phase 3 until 2026-08-04 and went unnoticed only
because every phase is idempotent. The runner is now the single entry point, in
Docker and by hand alike; the phase files carry no CLI block, and
[app/tests/migration-runners.test.ts](app/tests/migration-runners.test.ts) walks
each runner's imports and fails if one reappears. Idempotence is still required
of every phase — it is what makes a retried start safe — but it is no longer
what keeps a normal start correct.

**Running a migration by hand** means running its **runner**
(`npx tsx scripts/migrate-phase9-runner.ts` from `app/`), not the phase file —
the phase file only exports the function. The runner resolves its DB through
`scripts/cli-db-path.ts`: the default is the repo-root DB **relative to the
script**, not to `cwd`, and a path that does not exist is a hard error. A
missing `FUNNELS_DB_PATH` used to make the runner print a notice and exit 0;
now it falls back to that default, because a migration that silently skips
leaves the app serving a database it was never migrated for. Before this, running from the repo
root instead of `app/` pointed at nothing, better-sqlite3 created an empty file
next to the repo, and phases 5/6 reported success without touching the real
database — their DDL is all `CREATE TABLE IF NOT EXISTS`, and SQLite only checks
foreign keys on DML. Docker and tests are unaffected: they always pass the path
explicitly.

One-off / local-only scripts (NOT in any automated path): `seed-phase1.ts`,
`apply_phase2c_boo.ts` (operates on a scratchpad copy, never the real DB),
`migrate-messenger-tagtype.ts`, `backfill-messenger-tags.ts`,
`backfill-status.ts`.

`app/scripts/archive/` holds one-off scripts that have already run on the live
DB and never will again — the record of where the data came from. The directory
is **excluded from `tsc`** ([app/tsconfig.json](app/tsconfig.json)): a script is
written against the domain model of the day it was applied, and rewriting
seventeen finished files to satisfy today's types would misrepresent what was
actually done. Phase-10 moved every `landing_url` script there. Write new one-off
scripts in `scripts/`, then move them here once applied.

## Auth (`app/src/lib/auth.ts`, `auth-server.ts`, `middleware.ts`)

Модель — **«читают все, пишут свои»**. Список воронок и карточки открыты
анонимно; справочники, теги, мониторинг, CSV-экспорт и любой не-GET — только
редактору. Сервис публично читаем по URL: `X-Robots-Tag: noindex, nofollow` на
каждом ответе и `app/src/app/robots.ts` — это просьба поисковикам, не защита.

Решение принимает **одна чистая функция** `resolveAccess(env, req)` в
[app/src/lib/auth.ts](app/src/lib/auth.ts) — Edge-безопасная (никаких `node:*`,
`next/headers`, БД), потому что её вызывают оба рубежа:

1. **`middleware.ts`** (Edge) — первый рубеж на каждый запрос.
2. **`requireEditor(req)`** (`auth-server.ts`) — второй рубеж, первой строкой в
   каждом мутирующем обработчике и в GET приватных роутов; `EditorGate` —
   то же для страниц `/refs`, `/tags`, `/monitoring` (они рендерят данные прямо
   из БД, минуя API). Дублирование намеренное: `matcher` мидлвары ломается одной
   правкой и молча. Функция общая, поэтому рубежи не разъедутся.

Общая функция сама по себе от расхождения **не спасает** — разъезжается
извлечение запроса. Так и было: `getViewer` не читал `Authorization` вовсе, и
редактор по Basic получал 307 на `/refs` и режим просмотра на карточке, хотя
его запись API уже принимала. Поэтому `getViewer` и `requireEditor` ходят через
один `resolveAccessFrom` в `auth-server.ts`: разными остаются только источники
строк (`next/headers` в RSC против `Request` в роуте).

**Лимит перебора пароля** (`login-attempts.ts`, 10 попыток за 15 минут на
`ip|имя`) стоит в трёх местах, и место тут важнее логики:

- `POST /api/auth/login` — форма входа;
- **`middleware.ts`** — перебор через `Authorization: Basic`. Именно здесь, а не
  в роуте: на отказ мидлвара формирует ответ сама, и роут не исполняется вовсе.
  Пока проверка висела только в `requireEditor`, она была мёртвым кодом на любом
  пути, который закрывает `matcher` — то есть почти на всех. Роутовые тесты
  этого не видят, они зовут обработчик напрямую; ловится только замером на
  `.next/standalone`;
- `requireEditor` — та же проверка как защита в глубину, на случай сломанного
  `matcher`.

Два последних счётчика — **физически разные** (Edge и Node не делят
`globalThis`, см. раздел про синглтоны), поэтому суммарно на ключ приходится до
`2 × LOGIN_MAX_ATTEMPTS`. Свести в один можно только через внешнее хранилище.
Ни анонимное чтение, ни cookie-сессия в счётчик не попадают — только запросы, где
Basic реально предъявлен и решение принял именно он. `forbidden-origin` провалом
не считается: `resolveAccess` отбивает по Origin **до** проверки пароля, так что
там мог быть и верный.

Порядок решений (`AccessDecision`):

- `ADMIN_AUTH_DISABLED === 'true'` (ровно) → `disabled`: авторизации нет вообще —
  **но только вне прода** (`isKillSwitchIgnored` в `auth.ts`). В проде эта
  переменная теперь ни на что не влияет: именно эта строка когда-то стояла в
  решении раньше самих учёток и раньше fail-closed-503 прода, поэтому забытая
  на боевом сервере «на время» переменная держала сервис публично
  **редактируемым**, а не только читаемым, больше месяца — никто не заметил,
  потому что ничего не ломалось и незачем было смотреть на конфиг. Аварии,
  которую решает поголовное отключение авторизации в проде, не существует:
  потеряли пароль — задают новый `ADMIN_USERS`; нужно снять защиту чтения — для
  этого есть `PUBLIC_READ_ENABLED`, не трогающий запись. Локальная разработка и
  dev-стек не пострадали: там kill-switch работает как раньше, а `resolveAccess`
  и без него открывает всё без единой заданной переменной (см. ниже).
- Не-GET с `Origin`, чей хост ≠ `Host` → `forbidden-origin` (403). Проверка идёт
  **до** определения редактора: CSRF-запрос приходит как раз со своей cookie.
  Отсутствующий `Origin` не блокируем — его не шлют curl и скрипты, а браузер
  от кросс-сайтовой записи уже отсечён `SameSite=Lax`.
- Валидная сессия **или** `Authorization: Basic` из `ADMIN_USERS` /
  `ADMIN_BASIC_AUTH` → `allow`.
- Учётки не настроены: вне прода → `open` (всё разрешено, локальная разработка
  и тесты работают без единой переменной); в проде → чтение работает, запись
  отвечает `misconfigured` (503). Забытая переменная не даёт админку на запись.
- Дальше аноним: `/login` и `/api/auth/*` всегда `allow`; не-GET →
  `unauthorized`; путь из белого списка `isPublicReadPath` → `allow`; иначе
  страница → `redirect-login`, API → `unauthorized` (редирект в ответ на fetch
  вернул бы HTML вместо JSON).

`isPublicReadPath` — **белый список**, не «всё, кроме»: новый роут по умолчанию
закрыт. В нём `/`, `/funnels/<id>`, `/help` и только те GET-и API, без которых
они не отрисуются. `/api/export` там нет сознательно — один GET отдаёт всю базу.

**Сессия** — stateless: cookie `kf_session` вида `v1.<payload>.<hmac>`,
HMAC-SHA256 через Web Crypto (одна реализация на Edge и Node), `HttpOnly` +
`SameSite=Lax` + `Secure` в проде, срок 30 дней без скользящего продления.
Имя из токена сверяется с `ADMIN_USERS` на каждом запросе, поэтому удаление
строки отзывает доступ сразу, а не через месяц. `ADMIN_SESSION_SECRET`
обязателен в проде (минимум 16 символов): слабый ключ — подделываемая сессия;
вне прода выводится из `ADMIN_USERS`, так что локально настраивать нечего.

**В интерфейсе** право приходит из серверного layout (`getViewer`) в клиентский
контекст `AuthProvider` → `useCanEdit()`. Анониму те же экраны: текстовые поля
`readOnly` (не `disabled` — за ссылкой сюда и приходят, а из `disabled` её не
выделишь), селекты и тумблеры `disabled`, кнопки сохранения и удаления скрыты.
`RefSelect` в этом режиме **не ходит** в `/api/refs` — он анониму закрыт, и
запрос вернул бы 401. Это отражение прав, а не защита: запрещают два рубежа.

`PUBLIC_READ_ENABLED=false` возвращает прежнюю модель «всё под авторизацией»
без выката кода.

## Deployment

Dokploy builds the production image from `app/Dockerfile` (build context `app/`).
Full notes: [app/DEPLOY.md](app/DEPLOY.md).

- Mount a persistent volume at `/data`; set `FUNNELS_DB_PATH=/data/ksamata_funnels.db`.
- **First start:** entrypoint seeds `/data/ksamata_funnels.db` from the baked-in
  `/app/seed/` DB. Subsequent starts skip the copy and run the idempotent
  migration chain (Phase 2→6 + backfill).
- Container listens on port 3000.
- Background monitoring runs inside the container (`src/instrumentation.ts`),
  every `MONITOR_INTERVAL_MINUTES` (default 15). Set `MONITOR_ENABLED=false`
  to turn it off — only the exact string `false` disables it.
- `app/next.config.ts` carries an Edge-build workaround: because
  `middleware.ts` runs on the Edge runtime, Next also compiles
  `src/instrumentation.ts` with the Edge compiler, and webpack statically
  resolves its dynamic `import('./lib/monitor-scheduler')` into
  `src/db/client.ts` (`fs`/`path`/`better-sqlite3`), which fails the Edge
  build. The config aliases that file's absolute path to `false` for the
  Edge bundle only — plus `src/lib/monitor-resolver.ts`, reached by the same
  chain and Node-only for the same reason (`node:dns`). Read the comment there
  before touching it. **Adding a Node-only import anywhere under
  `monitor-*.ts` will break `npm run build` even though tests and `tsc` stay
  green** — isolate it in its own leaf file and alias that, rather than
  widening the alias to a whole subtree.

`docker-compose.yml` at the repo root is a **dev** stack (`app/Dockerfile.dev`,
hot-reload, auth off) that bind-mounts the real repo DB at `/data`. It does
**not** run the entrypoint seed/migration flow — that path is production-only.

Env vars: `FUNNELS_DB_PATH`, `ADMIN_USERS`, `ADMIN_SESSION_SECRET`,
`PUBLIC_READ_ENABLED`, `ADMIN_BASIC_AUTH`, `ADMIN_AUTH_DISABLED`,
`MONITOR_ENABLED`, `MONITOR_INTERVAL_MINUTES`, `NODE_ENV`, `PORT`. See
[app/.env.example](app/.env.example).

## Data tools (`tools/`)

Python scripts resolve paths from the **repo root** (via their own file
location), so they run from any working directory.

**Python tools still write columns the app no longer reads** —
`funnels.landing_url` (Phase 10) и семь URL-колонок дашбордов
(`dash_sales_url`, `dash_pereliv_url`, `regi_total_url`, `regi_15_url`,
`regi_19_url`, `regi_notime_url`, `predspisok_url`, Phase 11). Nothing breaks:
обе фазы выполняются при каждом старте контейнера и сметают попавшее туда в
блоки «Лендинги» и «Ссылки». But after running an import against a local DB,
run both phases by hand (`npx tsx scripts/migrate-phase10-runner.ts` and
`npx tsx scripts/migrate-phase11-runner.ts` from `app/`) or the addresses stay
invisible until the next container start.

- **Import** (`tools/data-import/`): `add_av_tags.py`, `add_durations.py`,
  `add_dih_funnel.py`, `add_pereliv_funnels.py`, `add_quiz_funnels.py` — all
  idempotent. **They no longer write `funnel_tags`**: `guard_tag_write`
  (`tag_write_guard.py`) stops them with an explanation, because that table is
  the materialized result of template + overrides and the first resync in the
  admin wipes anything written by hand — silently. Escape hatch `--force-tags`
  for a deliberate one-off, mirroring the `--force` idiom below.
  `ksamata_funnels_db.py` is **not** idempotent: it rebuilds the whole DB from
  Excel and therefore deletes the existing file, wiping everything edited through
  the admin UI. It refuses to run when the DB exists unless given `--force`.
  Tests: `python3 -m pytest tools/data-import/tests`.
- **Export** (`tools/data-export/`): `ksamata_funnels_export.py` → summary XLSX
  in `data/generated/`. Opens the DB **read-only** (`mode=ro`), like
  `tools/audit`: a plain `connect` would create an empty database where the real
  one is missing and then fail on the first SELECT.
  Tests: `python3 -m pytest tools/data-export/tests`.
- **Audit** (`tools/audit/`): `run_audit.py` builds a tag drift map across
  three sources — the GetCourse offer registry, `deal_export` history, and
  the DB — into an XLSX report with 14 finding classes (3 and 6 retired by
  Phase 14 — the stage they reported is a scenario now, and class numbers
  are never reused); it fixes nothing, in
  the DB or in GetCourse. The DB is opened read-only; GetCourse credentials
  are read from the environment (`GC_DEV_KEY`, `GC_API_KEY`, `GC_DOMAIN`) and
  never committed. `--no-api` skips GetCourse (classes 9-12 and 14 stay
  empty). Tests: `python3 -m pytest tools/audit/tests`.

## LeakEngine — приёмник F-кодов, и он пишется

Полное описание — [docs/leak-engine.md](docs/leak-engine.md). Что важно знать
до того, как туда пойти:

- **F-код назначает база, ЛИК его принимает** (решение владельца 2026-08-04).
  Новая воронка заводится сначала здесь и сразу получает `max(F) + 1`; владелец
  переносит её в ЛИК под тем же кодом. Пустой код при заведении — больше не
  норма. Максимум считается по обеим сторонам: если в ЛИК номер выше нашего,
  берём выше него. Оси, комнаты и статусы в спорных случаях тоже решает база.
- **Воронки в ЛИК не выключаем — никогда.** Расхождение «у нас `archive`, в ЛИК
  `ACTIVE`» расхождением не считается.
- Реестр читается **одним GET** `/app-api/api/admin/funnels` из вкладки уже
  залогиненного браузера (Chrome MCP), по сессионной куке — токена нет, `curl`
  не годится. Копию снимка на диск не кладём: она устаревает быстрее, чем
  успевает пригодиться.
- **Запись возможна и описана**, но только по прямой просьбе владельца:
  заведение воронки — два шага (сама воронка, затем набор правил), и активация
  набора правил **запускает пересчёт заявок** с указанной даты. Дату всегда
  спрашивать: вызов API идёт мимо окна подтверждения, которое рисует интерфейс.
- **Воронки в ЛИК не выключаем — никогда.** Решение владельца 04.08: «В ЛИК
  ничего не отключаем, пусть там всё будет в статусе актив, это не мешает
  работе ЛИКа». Это отменяет часть решения от 02.08 о выключении там семи
  воронок (`f6`, `f12`, `f13`, `f19`, `f33`, `f43`, `f58`) — их не трогаем, и
  расхождение «у нас `archive`, в ЛИК `ACTIVE`» расхождением больше не
  считается. Правило про «база главнее» остаётся: статус решает база, просто
  выравнивать его в ЛИК не нужно.
- **Проверять живость комнаты надо на `web.ksamatacenter.com/room/<код>`** —
  это сама комната. `gc.ksamata.ru/<код>` — лишь страница GetCourse, и её
  отсутствие о комнате не говорит ничего. На этом уже ошиблись однажды, объявив
  живые комнаты `f25` несуществующими. Оба хоста дают внятный ответ на
  несуществующий код: `gc` — 404, `web` — 200 с «Веб-комната не найдена».
- Идиома владельца: **воронка-копия резервирует номер.** Её правила побайтово
  повторяют чужие, содержимого ещё нет — сверять такую по осям бессмысленно,
  верно у неё только имя. Так появились `f80` (позже донастроена) и `f84`.

## Conventions

- Treat `app/` as the production service boundary.
- **Сервис называется «Ксамата · Воронки», и только так** — шапка (`AppHeader`),
  `<title>` в `layout.tsx`, заголовок справки. Английского «Ksamata Funnels
  Admin» в интерфейсе больше нет. Единственное исключение — `realm` в
  `WWW-Authenticate` (`Ksamata Voronki`, латиницей): по RFC 7235 это
  ASCII-строка, и кириллица в ней покажется мусором в окне пароля браузера.
- Keep `ksamata_funnels.db` at the repo root unless a task explicitly migrates
  every path (tests, Python tools, seed, env defaults).
- Do not commit SQLite sidecars, local `*.db.bak_*` backups, `.env.local`,
  generated exports, or the local `ksamata-leak-funnels/` dataset.
- Prefer focused changes verified from `app/`: `npx tsc --noEmit`,
  `npx vitest run`, `npm run build`.
- Mutate funnel data (especially tags) through the app's tsx logic or API, never
  raw SQL against the live DB.
- **`replaceBlock` does not validate URLs — the PUT route does.** A script
  writing block items must run every URL through `checkUrlField`
  ([app/src/lib/url-field.ts](app/src/lib/url-field.ts)) itself, because the
  admin refuses to save what it would have rejected on input.
  `fill-dashboards-2026-08-12.ts` obeyed the rule above — it went through
  `replaceBlock` — and still wrote 20 URLs with unencoded brackets
  (`?uc[segment_id]=`) into nine funnels. Opening any of those cards and
  pressing save then returned 400 on a line the human never touched, and the
  same nine were the ones prod's API refused when the links were carried over.
  Pinned by [app/tests/block-url-hygiene.test.ts](app/tests/block-url-hygiene.test.ts).
- **Never show `num` to a human, and never derive an F code from it.** It is the
  internal key; the F code is what is written on the card, in LeakEngine and in
  every external material. Search, delete confirmations, the monitoring chips
  and the CSV all identify a funnel by `frontCode` (falling back to `#id` via
  `funnelRefLabel`) — `num` survives in the export only as the `ID` column. When
  the two were mixed, searching `f70` returned both the real f70 and the funnel
  whose `num` is 70 but whose card reads f74.
  Адрес карточки — тоже F-код: `/funnels/f86`. Строится он **только** через
  `funnelHref` ([app/src/lib/front-code.ts](app/src/lib/front-code.ts)) —
  собранный руками `/funnels/${id}` ловит
  [app/tests/funnel-href-consistency.test.ts](app/tests/funnel-href-consistency.test.ts).
  Числовой адрес остаётся вечным запасным входом и редиректит на канон
  временным 307: постоянный 308 браузер кеширует навсегда, а код редактируем.
- Never leave `ksamata_funnels.db` modified after a live run — restore it (see
  the monitoring gotcha above). Its `monitor_*` tables must stay empty.
- **Never rebase a commit that touches `ksamata_funnels.db` onto a base that
  touched it too.** The file is binary, so git has no merge for it: a replay
  swaps the whole blob in **without reporting a conflict**, silently discarding
  the other side's rows. Check before rebasing or merging —

  ```sh
  git log --oneline <your-branch>..main -- ksamata_funnels.db
  ```

  — and if it prints anything, do not rebase: reset onto the new base and
  re-apply your change by running its script again. On 2026-08-12 that check
  was the only thing standing between a routine rebase and the silent loss of
  `funnel_types.has_time` (Phase 12) and an un-archived funnel, both committed
  by another session within the same hour. This is also why a data change
  belongs in its own commit and must be reproducible from a script: an edit
  made by hand in the admin cannot be replayed onto a moved base.
- Put process-wide state on `globalThis`, not in a module-level `let` — the
  production bundle duplicates modules (see above).
- Tests run against a temp **copy** of the DB, never the live file. Make that
  copy with `copyDbForTest` ([app/tests/helpers/db.ts](app/tests/helpers/db.ts)),
  not `copyFileSync`: the plain copy takes only the main file and leaves behind
  everything sitting in `*.db-wal` — which, with a dev server running, is every
  recent write. `VACUUM INTO` gives a consistent snapshot regardless of WAL
  state and is synchronous, which module-level fixtures need.
- **A test must not assert a mutable business value of the live DB.** The suite
  copies the real database, so a status or a landing URL that the owner is free
  to change tomorrow is not a fixture. `seed-phase1.test.ts` asserted
  `num 35 → status = 'draft'`; the seed *skips* a `num` that already exists, so
  that line had been reading the live value, not the seed's, and it broke the
  day f34 went active — catching nothing. Assert seeded values only for rows
  the seed actually created (the file's `countBeforeSeed` idiom), and pin
  invariants, not today's data.
- **A one-off script must name its target database in its header — repo or
  prod.** They hold different data: `/data` is seeded from `app/seed/` only on a
  container's **first** start, so a script run against the repo DB never reaches
  the people working in the admin, and no deploy will carry it there.
  `fill-dashboards-2026-08-12.ts` wrote 55 links from the owner's spreadsheets
  into the repo DB alone; they stayed invisible in production until they were
  carried over by hand a day later. Data meant for the admin goes to prod
  through its API (below).
- Mutating **prod** goes through its own HTTP API, not raw SQL on `/data`:
  creating a funnel pulls in ref rows and tag materialization. The container has
  no `tsx`, so run a `.cjs` against `127.0.0.1:3000` from inside it — the editor
  credential is read from the container's own `ADMIN_USERS` and never has to be
  typed or pasted anywhere. Back up first with `VACUUM INTO` (prod's WAL is
  large and live).
- For non-trivial or resumable work, use Basic Memory (see [AGENTS.md](AGENTS.md)).

## Docs & planning

- **Начинать сессию по данным с прогона `python3 tools/reconcile/run.py`** —
  рабочий список расхождений собирает он, отчёт ложится в `data/generated/`,
  порядок разбора — [2026-08-04-razbor-design.md](docs/plans/2026-08-04-razbor-design.md).
- [docs/OPEN.md](docs/OPEN.md) — то, чего инструмент не покрывает: вопросы к
  ЛИК, схема, безопасность. **Ведётся руками и потому устаревает** (актуально
  на 2026-08-04, часть пунктов уже разошлась с реальностью — файл говорит об
  этом сам). Указатель, а не источник истины.
- [README.md](README.md) — high-level orientation.
- [docs/README.md](docs/README.md) — index of plans and specs (shipped vs active).
- [docs/development.md](docs/development.md) — local setup and DB contract detail.
- [docs/project-map.md](docs/project-map.md) — file-level map.
- [docs/sheet-links-source-map.md](docs/sheet-links-source-map.md) — карта
  таблицы «Воронки ссылки»: колонки по листам, объёмы, во что превращается,
  ловушки. **Начинать с неё любую сборку ссылок из этой таблицы.**
- [docs/leak-engine.md](docs/leak-engine.md) — LeakEngine: эталон F-кодов,
  чтение и запись реестра.
- Живые планы: [ux-improvements-backlog](docs/plans/2026-07-18-ux-improvements-backlog.md)
  (открытый бэклог), [tag-drift-triage](docs/plans/2026-07-25-tag-drift-triage.md)
  (начинать с него любую сессию по тегам),
  [leak-new-funnels 24.08](docs/plans/2026-08-24-leak-new-funnels.md)
  (**начинать с него любую сессию по ЛИК** — заведение воронок, обновлённый
  контракт формы, заведение через интерфейс и замена легаси-фильтров —
  завершена, 21 набор из 22),
  [leak-ui-recon 24.08](docs/plans/2026-08-24-leak-ui-recon.md) (бриф на
  разведку интерфейса ЛИК),
  [leak-tag-filter-audit 04.08](docs/plans/2026-08-04-leak-tag-filter-audit.md)
  (три открытых неизвестных; первое из них — что значит `effectiveFrom = null` —
  закрыто ответом вендора 24.08),
  [leak-sync 02.08](docs/plans/2026-08-02-leak-sync.md) и
  [leak-todo 02.08](docs/plans/2026-08-02-leak-todo.md) (предыдущие сверки с ЛИК),
  [table-sync 04.08](docs/plans/2026-08-04-table-sync.md) — сверка с таблицей
  владельца. **По комнатам эта таблица не эталон:** она копирует мёртвую
  колонку `room_id_f1`, и при расхождении правится таблица, а не база.
