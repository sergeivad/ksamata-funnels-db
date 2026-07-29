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

Planning docs are a **historical record**. The live source of TODOs is the one
active backlog below, plus Basic Memory.

## Active planning

| File | Topic | Status |
|---|---|---|
| [plans/2026-07-18-ux-improvements-backlog.md](plans/2026-07-18-ux-improvements-backlog.md) | Admin UX-review backlog (P1/P2/P3 + tech debt) | **Active** — most items done; ~10 open (DRY refactors, N+1 in `listFunnels`, legacy schema columns, retiring old monitor targets). URL-field hygiene and the monitoring group counters shipped 2026-07-25 |
| [reviews/2026-07-26-service-review.md](reviews/2026-07-26-service-review.md) | Service-wide review: 7 dimensions, 48 verified findings + 4-wave action plan | **Active** — nothing fixed yet. Wave 1 is a Dokploy config change (`ADMIN_AUTH_DISABLED`); wave 2 is silent data loss (day deletion in rooms, PATCH tags, `ksamata_funnels_db.py` deleting the live DB, monitoring retirement vs `manual_override`) |

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
| Funnel type — fifth axis (`funnel_types`, Phase 7) | [funnel-type-fifth-axis-design](superpowers/specs/2026-07-28-funnel-type-fifth-axis-design.md) | [funnel-type-fifth-axis](superpowers/plans/2026-07-28-funnel-type-fifth-axis.md) |
