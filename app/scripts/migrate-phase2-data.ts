/**
 * Canonical seed data and DDL shared by both Phase-2 migration scripts:
 *   - migrate-phase2.ts        (Drizzle-based, used by tests + local CLI)
 *   - migrate-phase2-runner.ts (raw better-sqlite3, compiled to .cjs by esbuild for Docker)
 *
 * Keep this file as the single source of truth for channels, directions,
 * and table definitions. Editing here updates both scripts automatically.
 */

// ─── Seed data ────────────────────────────────────────────────────────────────

export const CHANNELS: string[] = ['Ютуб', 'Яндекс', 'ВК', 'МАКС', 'Перелив'];

export const DIRECTIONS: string[] = [
  'Органика',
  'Реклама',
  'РСЯ',
  'In Stream',
  'Маркетплатформа',
  'Посевы',
  'Ретаргет',
  'Перелив с БОО',
  'Перелив с ДБО',
  'Квиз',
];

// ─── DDL ──────────────────────────────────────────────────────────────────────

export const MIGRATION_DDL = `
CREATE TABLE IF NOT EXISTS channels (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS directions (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);
`;

// Funnels columns introduced in Phase-2 (previously added by the now-removed
// migrate.sh). Added idempotently so from-scratch DBs get them too.
export const PHASE2_FUNNEL_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'status',     ddl: `ALTER TABLE funnels ADD COLUMN status TEXT DEFAULT 'active'` },
  { name: 'front_code', ddl: `ALTER TABLE funnels ADD COLUMN front_code TEXT DEFAULT ''` },
];

/** Add a column only if it is not already present (SQLite lacks ADD COLUMN IF NOT EXISTS). */
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
