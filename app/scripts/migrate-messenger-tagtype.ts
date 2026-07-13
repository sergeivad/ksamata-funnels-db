/**
 * Schema migration: widen funnel_tags.tag_type CHECK to allow 'messenger'.
 *
 * The original table bakes `CHECK(tag_type IN ('reg','time_19','time_15'))`
 * into its DDL. SQLite can't ALTER a CHECK constraint, so we rebuild the table
 * (create-copy-drop-rename), preserving rows and indexes. Idempotent: a no-op
 * once the constraint already lists 'messenger'.
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-messenger-tagtype.ts
 */

export function runMigrateMessengerTagType(sqlite: import('better-sqlite3').Database): void {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='funnel_tags'")
    .get() as { sql: string } | undefined;

  // Table missing (fresh schema already includes it) or constraint already widened → nothing to do.
  if (!row || row.sql.includes("'messenger'")) return;

  sqlite.pragma('foreign_keys = OFF');
  const rebuild = sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE funnel_tags_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          funnel_id   INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
          tag_id      INTEGER NOT NULL REFERENCES tags(id),
          tag_type    TEXT NOT NULL CHECK(tag_type IN ('reg', 'time_19', 'time_15', 'messenger')),
          position    INTEGER NOT NULL DEFAULT 0,
          UNIQUE(funnel_id, tag_id, tag_type)
      );
      INSERT INTO funnel_tags_new (id, funnel_id, tag_id, tag_type, position)
        SELECT id, funnel_id, tag_id, tag_type, position FROM funnel_tags;
      DROP TABLE funnel_tags;
      ALTER TABLE funnel_tags_new RENAME TO funnel_tags;
      CREATE INDEX idx_funnel_tags_funnel ON funnel_tags(funnel_id);
      CREATE INDEX idx_funnel_tags_tag    ON funnel_tags(tag_id);
    `);
    const fkErrors = sqlite.pragma('foreign_key_check') as unknown[];
    if (fkErrors.length > 0) {
      throw new Error(`foreign_key_check failed after funnel_tags rebuild: ${JSON.stringify(fkErrors)}`);
    }
  });
  rebuild();
  sqlite.pragma('foreign_keys = ON');
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Messenger tag_type migration on: ${dbPath}`);
  runMigrateMessengerTagType(sqlite);
  sqlite.close();
  console.log('Messenger tag_type migration done.');
}
