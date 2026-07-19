/**
 * Shared DDL + template seed for Phase-5 (flexible AV-tags).
 * Single source of truth for migrate-phase5.ts (tsx/tests) and the Docker runner.
 */

export const PHASE5_DDL = `
CREATE TABLE IF NOT EXISTS tag_templates (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario TEXT    NOT NULL CHECK(scenario IN ('reg','time_15','time_19','messenger')),
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tag_templates_scenario ON tag_templates(scenario);

CREATE TABLE IF NOT EXISTS funnel_tag_overrides (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  tag_type  TEXT    NOT NULL CHECK(tag_type IN ('reg','time_15','time_19','messenger')),
  name      TEXT    NOT NULL,
  op        TEXT    NOT NULL CHECK(op IN ('add','remove')),
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS funnel_tag_overrides_unique
  ON funnel_tag_overrides(funnel_id, tag_type, name);
CREATE INDEX IF NOT EXISTS idx_fto_funnel ON funnel_tag_overrides(funnel_id);
`;

/** Template seed — mirrors the previously hardcoded COMMON_TAGS + stage + time tags. */
export const PHASE5_TEMPLATE_SEED: { scenario: string; name: string; position: number }[] = [
  { scenario: 'reg',       name: 'автоворонки',        position: 0 },
  { scenario: 'reg',       name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'reg',       name: 'АВ Этап: Регистрация', position: 2 },

  { scenario: 'time_15',   name: 'автоворонки',        position: 0 },
  { scenario: 'time_15',   name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'time_15',   name: 'АВ Этап: Оплата',    position: 2 },
  { scenario: 'time_15',   name: 'АВ Время: 15',       position: 3 },

  { scenario: 'time_19',   name: 'автоворонки',        position: 0 },
  { scenario: 'time_19',   name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'time_19',   name: 'АВ Этап: Оплата',    position: 2 },
  { scenario: 'time_19',   name: 'АВ Время: 19',       position: 3 },

  { scenario: 'messenger', name: 'автоворонки',        position: 0 },
  { scenario: 'messenger', name: 'АВ Автоворонка',     position: 1 },
  { scenario: 'messenger', name: 'АВ Этап: Мессенджер', position: 2 },
];

/**
 * Seed tag_templates ONCE per DB, gated by a schema_migrations marker so a
 * second run never double-inserts (there is no natural UNIQUE key on the row).
 */
export function seedTagTemplates(sqlite: import('better-sqlite3').Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)`);
  const done = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name='phase5_template_seed'`).get();
  if (done) return;
  const insert = sqlite.prepare(`INSERT INTO tag_templates (scenario, name, position) VALUES (?, ?, ?)`);
  const tx = sqlite.transaction(() => {
    for (const r of PHASE5_TEMPLATE_SEED) insert.run(r.scenario, r.name, r.position);
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES ('phase5_template_seed')`).run();
  });
  tx();
}
