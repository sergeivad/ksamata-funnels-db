# Docs Index

Navigation for this repo's documentation and planning notes.

- **Canonical guide:** [../CLAUDE.md](../CLAUDE.md) — architecture, data model,
  migrations, auth, deployment, conventions.
- **Orientation:** [../README.md](../README.md)
- **Local setup & DB contract:** [development.md](development.md)
- **File-level map:** [project-map.md](project-map.md)

## Conventions

- `docs/superpowers/` — the spec-then-plan workflow. Each feature has a design
  **spec** and an implementation **plan** (usually a pair).
- `docs/plans/` — Codex-authored cleanup and backlog notes.

Planning docs are a **historical record**. The live source of TODOs is the one
active backlog below, plus Basic Memory.

## Active planning

| File | Topic | Status |
|---|---|---|
| [plans/2026-07-18-ux-improvements-backlog.md](plans/2026-07-18-ux-improvements-backlog.md) | Admin UX-review backlog (P1/P2/P3 + tech debt) | **Active** — most items done; ~10 open (data-quality checks, DRY refactors, N+1 in `listFunnels`, legacy schema columns) |

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
