/**
 * Shared DDL + column list for Phase-3 migration. Single source of truth for
 * both migrate-phase3.ts (tsx/tests) and migrate-phase3-runner.ts (Docker .cjs).
 */

export const PHASE3_FUNNEL_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'comment',              ddl: `ALTER TABLE funnels ADD COLUMN comment TEXT DEFAULT ''` },
  { name: 'time_label_a',         ddl: `ALTER TABLE funnels ADD COLUMN time_label_a TEXT DEFAULT '15:00'` },
  { name: 'time_label_b',         ddl: `ALTER TABLE funnels ADD COLUMN time_label_b TEXT DEFAULT '19:00'` },
  { name: 'rooms_replay_enabled', ddl: `ALTER TABLE funnels ADD COLUMN rooms_replay_enabled INTEGER DEFAULT 0` },
];

export const PHASE3_DDL = `
CREATE TABLE IF NOT EXISTS funnel_blocks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 0,
  mode      TEXT    NOT NULL DEFAULT 'common' CHECK(mode IN ('common','by_time'))
);

CREATE UNIQUE INDEX IF NOT EXISTS funnel_blocks_funnel_kind_unique ON funnel_blocks(funnel_id, kind);
CREATE INDEX IF NOT EXISTS idx_funnel_blocks_funnel ON funnel_blocks(funnel_id);

CREATE TABLE IF NOT EXISTS funnel_block_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id INTEGER NOT NULL REFERENCES funnel_blocks(id) ON DELETE CASCADE,
  slot     TEXT    DEFAULT NULL CHECK(slot IN ('15','19') OR slot IS NULL),
  label    TEXT    NOT NULL DEFAULT '',
  url      TEXT    NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fbi_block ON funnel_block_items(block_id);
`;

/** Add a column only if it is not already present (SQLite has no ADD COLUMN IF NOT EXISTS). */
export function addColumnIfMissing(
  sqlite: import('better-sqlite3').Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const present = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((r) => r.name === column);
  if (!present) sqlite.exec(ddl);
}
