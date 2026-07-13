/**
 * Backfill: re-sync AV tags on every existing funnel so they pick up
 * tag-generation rules added after they were created — the second
 * autofunnel tag ('автоворонки') alongside 'АВ Автоворонка', and the new
 * `messenger` scenario set ('АВ Этап: Мессенджер'). Idempotent: relies on
 * resyncFunnelAvTags (src/lib/funnels.ts), which deletes existing 'АВ %'
 * funnel_tags and re-inserts from axesToTagNames — safe to run any number
 * of times.
 *
 * Requires the schema to already support tag_type='messenger'
 * (see migrate-messenger-tagtype.ts) — run that migration first.
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/backfill-messenger-tags.ts
 */

import { type DB } from '../src/db/client';
import { listFunnels, resyncFunnelAvTags } from '../src/lib/funnels';

export function runBackfillMessengerTags(db: DB): number {
  const funnelList = listFunnels(db);
  let count = 0;
  for (const f of funnelList) {
    if (resyncFunnelAvTags(db, f.id)) count++;
  }
  return count;
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const schema = require('../src/db/schema');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  console.log(`Messenger-tags backfill on: ${dbPath}`);
  const count = runBackfillMessengerTags(db);
  sqlite.close();
  console.log(`Messenger-tags backfill done. Funnels processed: ${count}.`);
}
