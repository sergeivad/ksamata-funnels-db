/**
 * Shared column list + backfill for Phase-4 migration. Single source of truth
 * for both migrate-phase4.ts (tsx/tests) and migrate-phase4-runner.ts (Docker).
 *
 * Adds funnels.rooms_enabled (mirror of rooms_replay_enabled) and, once per DB,
 * backfills it: enabled where the funnel already has funnel_days rows, disabled
 * otherwise. The backfill never touches funnel_days.
 */

type DB = import('better-sqlite3').Database;

export const PHASE4_FUNNEL_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'rooms_enabled', ddl: `ALTER TABLE funnels ADD COLUMN rooms_enabled INTEGER DEFAULT 1` },
];

/** Marker recorded in schema_migrations once the one-time backfill completes. */
export const ROOMS_ENABLED_MIGRATION = 'phase4_rooms_enabled';

/**
 * One-time smart backfill: collapse funnels that have no day rows. Marker-gated
 * so it runs at most once per DB — later manual toggles are never overwritten.
 * Assumes the rooms_enabled column already exists.
 */
export function backfillRoomsEnabled(sqlite: DB): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );

  const already = sqlite
    .prepare(`SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1`)
    .get(ROOMS_ENABLED_MIGRATION);
  if (already) return;

  const run = sqlite.transaction(() => {
    sqlite.exec(
      `UPDATE funnels SET rooms_enabled = 0
         WHERE id NOT IN (SELECT DISTINCT funnel_id FROM funnel_days)`,
    );
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(ROOMS_ENABLED_MIGRATION);
  });
  run();
}
