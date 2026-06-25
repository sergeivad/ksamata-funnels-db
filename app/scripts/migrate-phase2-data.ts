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

CREATE TABLE IF NOT EXISTS funnel_links (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  label     TEXT    NOT NULL DEFAULT '',
  url       TEXT    NOT NULL DEFAULT '',
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_funnel_links_funnel ON funnel_links(funnel_id);
`;
