# Docs Index

Navigation for this repo's documentation and planning notes.

- **Canonical guide:** [../CLAUDE.md](../CLAUDE.md) — architecture, data model,
  migrations, auth, deployment, conventions.
- **Orientation:** [../README.md](../README.md)
- **Local setup & DB contract:** [development.md](development.md)
- **File-level map:** [project-map.md](project-map.md)
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
| [plans/2026-07-18-ux-improvements-backlog.md](plans/2026-07-18-ux-improvements-backlog.md) | Admin UX-review backlog (P1/P2/P3 + tech debt) | **Active** — most items done; ~10 open (DRY refactors, N+1 in `listFunnels`, legacy schema columns, retiring old monitor targets). URL-field hygiene and the monitoring group counters shipped 2026-07-25 |
| [plans/2026-07-25-tag-drift-triage.md](plans/2026-07-25-tag-drift-triage.md) | Живой журнал разбора карты расхождений тегов (16 классов находок) | **Active** — **начинать с него любую сессию по тегам.** Открыт фактически один вопрос: что считать шагом (сценарием) воронки; до него классы 1 и 5 не разбираются |
| [reviews/2026-07-26-service-review.md](reviews/2026-07-26-service-review.md) | Service-wide review: 7 dimensions, 48 verified findings + 4-wave action plan | **Closed 2026-07-31** — 40 of 48 fixed across seven waves. Wave 1 (the anonymous-write hole) shipped as the auth model «читают все, пишут свои» + an inert prod kill-switch. Of the eight not fixed, none is debt: DNS rebinding and CSRF were deliberate calls, three are informational, the rest are `tools/audit` tails owned by the tag sessions |

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
