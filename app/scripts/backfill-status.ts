/**
 * Backfill `status` and `front_code` for existing funnels.
 *
 * Rules (idempotent — safe to run multiple times):
 *   - status:     set to 'active' where NULL or ''
 *   - front_code: set to 'f' + num where currently '' (never overwrites non-empty)
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql, or, eq, isNull } from 'drizzle-orm';
import { funnels } from '../src/db/schema';

type AnyDB = ReturnType<typeof drizzle>;

export function runBackfill(database: AnyDB): void {
  // 1. Backfill status: set 'active' where NULL or empty string
  database
    .update(funnels)
    .set({ status: 'active' })
    .where(or(isNull(funnels.status), eq(funnels.status, '')))
    .run();

  // 2. Backfill front_code: set 'f' + num where front_code is empty ''
  //    We use raw SQL for the concatenation ('f' || num) and restrict to empty only.
  database
    .update(funnels)
    .set({ frontCode: sql`'f' || ${funnels.num}` })
    .where(or(isNull(funnels.frontCode), eq(funnels.frontCode, '')))
    .run();
}

// ─── CLI entry point ───────────────────────────────────────────────────────────
// Run with:  npx tsx scripts/backfill-status.ts
if (require.main === module) {
  // Import real DB client lazily so the module can also be used as a library.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require('../src/db/client');
  console.log('Running backfill against real DB...');
  runBackfill(db);
  console.log('Done.');
}
