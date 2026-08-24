# Docs Index

Navigation for this repo's documentation and planning notes.

- **Открытые вопросы, все и в одном месте:** [OPEN.md](OPEN.md) — указатель на
  всё нерешённое, сгруппированное по тому, кто должен действовать (мы в базе,
  мы в коде, владелец в ЛИК / GetCourse / таблице). **Начинать сессию с него.**
- **Canonical guide:** [../CLAUDE.md](../CLAUDE.md) — architecture, data model,
  migrations, auth, deployment, conventions.
- **Orientation:** [../README.md](../README.md)
- **Local setup & DB contract:** [development.md](development.md)
- **File-level map:** [project-map.md](project-map.md)
- **Карта таблицы «Воронки ссылки»:** [sheet-links-source-map.md](sheet-links-source-map.md)
  — какая колонка на каком листе, сколько в ней адресов, во что превращается
  и чему нельзя верить. Начинать с неё любую сборку ссылок из этой таблицы.
- **Эталон f-кодов (LeakEngine):** [leak-engine.md](leak-engine.md) — откуда
  берётся `funnels.front_code` и как забрать реестр через внутренний API.

## Conventions

- `docs/superpowers/` — the spec-then-plan workflow. Each feature has a design
  **spec** and an implementation **plan** (usually a pair).
- `docs/plans/` — Codex-authored cleanup and backlog notes.
- `docs/reviews/` — dated service-wide review reports (findings + action plan).

Planning docs are a **historical record**. The live source of TODOs is the
active planning below, plus Basic Memory.

## Basic Memory layout (project `main`)

Consolidated 2026-07-31 — the dossier had grown to 223 KB with three competing
"latest" snapshots, so a session start had to read the whole archaeology to find
the current state. Now split by lifetime, not by session:

| Note | Holds |
|---|---|
| `projects/ksamata-funnels-db` | **Read this one.** Current state, open questions, standing "do not do" list. Kept short on purpose |
| `projects/ksamata-funnels-db.lessons` | Durable method lessons (measuring, audit classes, mutation-testing, tooling gotchas) |
| `projects/ksamata-funnels-db.history` | Dated archive: past snapshots, per-session decisions, spent plans, session log |
| `projects/ksamata-funnels-db.observations` | Typed observations by date (the `/session-save` stream) |

## Active planning

| File | Topic | Status |
|---|---|---|
| [plans/2026-08-04-razbor-design.md](plans/2026-08-04-razbor-design.md) | **Порядок разбора: роли источников, этапы 0-3 и трек разметки ГК** | **Active** — **начинать с него любую сессию по сверке данных.** Заменяет 13 планов как рабочий список. Инструмент собран (`tools/reconcile/`), этап 0 закрыт. Главный вывод замера: база почти полна, основной источник расхождений — разметка предложений в ГК (26 133 оплаченных заказа без осей) |
| [plans/2026-08-04-reconcile-tool-plan.md](plans/2026-08-04-reconcile-tool-plan.md) | План реализации инструмента сверки | **Shipped 2026-08-04** — 59 тестов, прогон на живых данных сошёлся с известными фактами (те же семь расхождений статуса, что в `OPEN.md`) |
| [plans/2026-07-18-ux-improvements-backlog.md](plans/2026-07-18-ux-improvements-backlog.md) | Admin UX-review backlog (P1/P2/P3 + tech debt) | **Active** — most items done; ~10 open (DRY refactors, N+1 in `listFunnels`, legacy schema columns, retiring old monitor targets). URL-field hygiene and the monitoring group counters shipped 2026-07-25 |
| [plans/2026-07-25-tag-drift-triage.md](plans/2026-07-25-tag-drift-triage.md) | Живой журнал разбора карты расхождений тегов (16 классов находок) | **Active** — **начинать с него любую сессию по тегам.** Открыт фактически один вопрос: что считать шагом (сценарием) воронки; до него классы 1 и 5 не разбираются |
| [plans/2026-08-02-leak-sync.md](plans/2026-08-02-leak-sync.md) | Сверка базы с LeakEngine, прогон 02.08 | **Active** — правки применены локально и на проде (комнаты `f80` и `f78`, новая `f84`, активация 11 черновиков); в ЛИК заведены `f73`/`f74`/`f78`. Открыты два пункта: судьба мёртвой колонки `room_id_f1` и заблокированная схемой `f42` |
| [plans/2026-08-02-leak-todo.md](plans/2026-08-02-leak-todo.md) | Заведение `f73`, `f74`, `f78` в ЛИК + что поправить в ЛИК | **Active** — три воронки заведены и активны; `f84` донастроена владельцем к 04.08. Открыты две правки на стороне владельца: имя `f83` и выключить семь архивных — обе переехали в [leak-tag-filter-audit 04.08](plans/2026-08-04-leak-tag-filter-audit.md) |
| [plans/2026-08-04-table-sync.md](plans/2026-08-04-table-sync.md) | Сверка с таблицей владельца «Ссылки для сбора статы» | **Active** — применены лендинги и даты (25 воронок), `f28` переведён на нового подрядчика, `f84` активирован. Решено не заводить восемь квизов и прямых продаж. Открыты шесть пунктов: статус `f43`, живая ВК NR «ЖИВО Суставы 490р», комнаты дней 4-5, семь статусов, второй лист (зарубежные), дашборды. **По комнатам таблица не эталон** — она копирует мёртвую `room_id_f1` |
| [plans/2026-08-24-leak-new-funnels.md](plans/2026-08-24-leak-new-funnels.md) | Три новые воронки в ЛИК + правило замены легаси-фильтров | **Active** — **начинать с него любую сессию по ЛИК.** Заведены `f66`, `f68`, `f87` (реестр 63 → 66), комнаты `f66`/`f68` записаны в прод, `f95` перенесена с прода в репозиторную базу. Снято прежнее неизвестное: история при замене правил **не переписывается**, пересчёт идёт только от `effectiveFrom`. Замена легаси-фильтров у 22 воронок **заблокирована**: пересохранение набора теряет вебинарные настройки, механик обещал доработку. Сам замер по тегам готов и подтверждён независимо — 0 ₽ потерь, +86 290 ₽ при `effectiveFrom 2026-07-01` |
| [plans/2026-08-24-leak-ui-recon.md](plans/2026-08-24-leak-ui-recon.md) | Разведка интерфейса ЛИК: клики, порядок действий, что делает фронт сверх API | **Active** — бриф на отдельную сессию. Первое препятствие названо: синтетический клик по строке воронки карточку не открывает. Эталон для проверки «фронт делает лишний шаг» готов — `f66` против `f68`/`f87` |
| [plans/2026-08-04-leak-tag-filter-audit.md](plans/2026-08-04-leak-tag-filter-audit.md) | Сверка ЛИК ↔ база **по множествам заказов**, а не по строкам тегов | **Active** — Замер на `deal_export_2026-08-01`: выборки совпали у 52 воронок из 60, но наборы тегов — лишь у 37, то есть 15 совпадений сегодняшние и не гарантированы. Сделано: комнаты `f84` (10 шт.) перенесены локально. Открыты три **неизвестных**, без ответа на которые правки правил в ЛИК запрещены: что значит `effectiveFrom = null` (стоит у 43 наборов из 60), есть ли откат активации, снимает ли `INACTIVE` воронку с атрибуции |
| [reviews/2026-07-26-service-review.md](reviews/2026-07-26-service-review.md) | Service-wide review: 7 dimensions, 48 verified findings + 4-wave action plan | **Closed 2026-07-31** — 40 of 48 fixed across seven waves. Wave 1 (the anonymous-write hole) shipped as the auth model «читают все, пишут свои» + an inert prod kill-switch. Of the eight not fixed, none is debt: DNS rebinding and CSRF were deliberate calls, three are informational, the rest are `tools/audit` tails owned by the tag sessions |
| [superpowers/specs/2026-08-17-sheet-links-design.md](superpowers/specs/2026-08-17-sheet-links-design.md) | Сверка таблицы «Воронки ссылки» с блоками `tariffs`/`applications`/`upsell` (`tools/sheet-links/`) | **Shipped 18.08.2026** — инструмент собран, разбор починен (раскладка колонок определяется по листу, заголовок блока — по началу строки), результат залит в прод двумя заходами: 57 блоков, 143 позиции. Живая карта источника — [sheet-links-source-map.md](sheet-links-source-map.md); следующие виды ссылок (`records`, `bonuses`, `oto`, `landings`) описаны там же |

## Shipped — historical record

All features below are merged. Specs and plans are kept for context.

| Feature | Spec | Plan |
|---|---|---|
| Funnels Admin — Phase 1 (service design) | [service-design](superpowers/specs/2026-06-24-funnels-admin-service-design.md) | [phase1](superpowers/plans/2026-06-24-funnels-admin-phase1.md) |
| Funnels Admin — Phase 2 (editor refinements) | [phase2-design](superpowers/specs/2026-06-25-funnels-admin-phase2-design.md) | [phase2](superpowers/plans/2026-06-25-funnels-admin-phase2.md) |
| Funnel-card link-blocks redesign | [card-blocks-design](superpowers/specs/2026-06-25-funnel-card-blocks-redesign-design.md) | [card-blocks](superpowers/plans/2026-06-26-funnel-card-blocks-redesign.md) |
| Flexible per-funnel AV-tags | [flexible-tags-design](superpowers/specs/2026-07-19-flexible-tags-design.md) | [flexible-tags](superpowers/plans/2026-07-19-flexible-tags.md) |
| Funnel "archive" status | [archive-status-design](superpowers/specs/2026-07-19-funnel-archive-status-design.md) | [archive-status](superpowers/plans/2026-07-19-funnel-archive-status.md) |
| Webinar-rooms on/off toggle | [rooms-toggle-design](superpowers/specs/2026-07-19-rooms-enabled-toggle-design.md) | [rooms-toggle](superpowers/plans/2026-07-19-rooms-enabled-toggle.md) |
| AV-taxonomy tags (7-axis) | [av-taxonomy-design](superpowers/specs/2026-06-03-av-taxonomy-tags-design.md) | — (data commits) |
| Repo cleanup | [cleanup-design](plans/2026-07-07-project-cleanup-design.md) | [cleanup](plans/2026-07-07-project-cleanup.md) |
| Landing-availability monitoring | [landing-monitoring-design](superpowers/specs/2026-07-24-landing-monitoring-design.md) | [landing-monitoring](superpowers/plans/2026-07-24-landing-monitoring.md) |
| Funnel-tag drift map (`tools/audit/`) | [funnel-tag-drift-map-design](superpowers/specs/2026-07-24-funnel-tag-drift-map-design.md) | [funnel-tag-drift-map](superpowers/plans/2026-07-24-funnel-tag-drift-map.md) |
| Monitoring: per-group on/off decisions (`monitor_source_kind_prefs`) | — | [monitoring-source-kind-prefs](plans/2026-07-24-monitoring-source-kind-prefs.md) |
| Funnel type — fifth axis (`funnel_types`, Phase 8) | [funnel-type-fifth-axis-design](superpowers/specs/2026-07-28-funnel-type-fifth-axis-design.md) | [funnel-type-fifth-axis](superpowers/plans/2026-07-28-funnel-type-fifth-axis.md) |
| Dashboard/registration URL columns retirement (`links` block, Phase 11) | [dashboard-columns-retirement-design](superpowers/specs/2026-08-12-dashboard-columns-retirement-design.md) | [dashboard-columns-retirement](superpowers/plans/2026-08-12-dashboard-columns-retirement.md) |
