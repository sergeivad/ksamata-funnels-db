/**
 * Standalone Phase-2 migration script for Docker runner.
 *
 * Uses better-sqlite3 directly (no Drizzle) so it works in the slim
 * runner image where only node + better-sqlite3 are available.
 *
 * Compiled to migrate-phase2.cjs during the Docker builder stage via esbuild:
 *   npx esbuild scripts/migrate-phase2-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 \
 *     --outfile=migrate-phase2.cjs
 *
 * Invoked by docker-entrypoint.sh as:
 *   node /app/migrate-phase2.cjs
 */

import Database from 'better-sqlite3';

const CHANNELS: string[] = ['Ютуб', 'Яндекс', 'ВК', 'МАКС', 'Перелив'];

const DIRECTIONS: string[] = [
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

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[migrate-phase2] FUNNELS_DB_PATH is not set — skipping migration.');
  process.exit(0);
}

console.log(`[migrate-phase2] Running Phase-2 migration on: ${dbPath}`);

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create tables (idempotent)
sqlite.exec(`
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
`);

// Seed channels (idempotent via INSERT OR IGNORE)
const insertChannel = sqlite.prepare('INSERT OR IGNORE INTO channels (name) VALUES (?)');
for (const name of CHANNELS) {
  insertChannel.run(name);
}

// Seed directions (idempotent via INSERT OR IGNORE)
const insertDirection = sqlite.prepare('INSERT OR IGNORE INTO directions (name) VALUES (?)');
for (const name of DIRECTIONS) {
  insertDirection.run(name);
}

sqlite.close();

console.log(
  `[migrate-phase2] Done. channels: ${CHANNELS.length}, directions: ${DIRECTIONS.length}.`
);
