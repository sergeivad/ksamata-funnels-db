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
import { CHANNELS, DIRECTIONS, MIGRATION_DDL, PHASE2_FUNNEL_COLUMNS, addColumnIfMissing } from './migrate-phase2-data';

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
sqlite.exec(MIGRATION_DDL);

// Add Phase-2 funnels columns (idempotent; replaces migrate.sh)
for (const col of PHASE2_FUNNEL_COLUMNS) {
  addColumnIfMissing(sqlite, 'funnels', col.name, col.ddl);
}

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
