/**
 * Backfill `status` and `front_code` for existing funnels.
 *
 * Rules (idempotent — safe to run multiple times):
 *   - status:     set to 'active' where NULL or ''
 *   - front_code (num 1–26):  set to 'f' + num where currently NULL or ''
 *                             (never overwrites a non-empty, manually-set value)
 *   - front_code (num >= 27): these are legacy/unknown funnels not on the current
 *                             frontend — their real f-code is unknown.
 *                             RESET to '' if the current value equals the wrong
 *                             auto-pattern 'f{num}' (clears bad backfill values),
 *                             but leave genuinely manual codes untouched.
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql, or, eq, isNull, lte, gte, and } from 'drizzle-orm';
import { funnels } from '../src/db/schema';

type AnyDB = ReturnType<typeof drizzle>;

export function runBackfill(database: AnyDB): void {
  // 1. Backfill status: set 'active' where NULL or empty string
  database
    .update(funnels)
    .set({ status: 'active' })
    .where(or(isNull(funnels.status), eq(funnels.status, '')))
    .run();

  // 2a. Backfill front_code for num 1–26: set 'f' + num where front_code is empty.
  //     Never overwrites a non-empty value (idempotency).
  database
    .update(funnels)
    .set({ frontCode: sql`'f' || ${funnels.num}` })
    .where(
      and(
        lte(funnels.num, 26),
        or(isNull(funnels.frontCode), eq(funnels.frontCode, '')),
      ),
    )
    .run();

  // 2b. For num >= 27: clear any auto-pattern value ('f' || num) back to ''.
  //     These legacy/quiz funnels are not on the frontend; their real f-codes
  //     are unknown. If someone previously set the wrong f27..f32 via an earlier
  //     backfill run, we reset it. A genuinely manual code (that does NOT equal
  //     'f' || num) is left untouched.
  database
    .update(funnels)
    .set({ frontCode: '' })
    .where(
      and(
        gte(funnels.num, 27),
        eq(funnels.frontCode, sql`'f' || ${funnels.num}`),
      ),
    )
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
