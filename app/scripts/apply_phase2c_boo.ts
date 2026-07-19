/**
 * Phase 2c — fix the broken custom tag «тег: БОО» → «БОО» on funnels
 * num 6/19/22/24 in the payment scenarios (time_15/time_19).
 *
 * «тег: БОО» is a typo'd custom override (the "тег: " label leaked into the
 * value). Real GetCourse deals use «БОО». We rename the override, re-materialize
 * funnel_tags via the app's own resyncFunnelAvTags, and drop the now-orphaned
 * «тег: БОО» tag row.
 *
 * SAFETY: never touches the original DB — copies it to the scratchpad and
 * points FUNNELS_DB_PATH at the copy BEFORE importing the db client singleton.
 *
 * Run: cd app && npx tsx scripts/apply_phase2c_boo.ts
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const APP_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');
const ORIG_DB = path.resolve(REPO_ROOT, 'ksamata_funnels.db');
const SCRATCHPAD =
  process.env.SCRATCHPAD_DIR ??
  '/private/tmp/claude-501/-Users-sergeielkin-dev-ksamata-Ksamata-ksamata-funnels-db/297da5fd-65d9-41bb-9a0b-a421b21610bc/scratchpad';
const COPY_DB = path.join(SCRATCHPAD, 'ksamata_funnels.phase2c.db');

const TARGET_NUMS = [6, 19, 22, 24];
const OLD = 'тег: БОО';
const NEW = 'БОО';

async function main() {
  if (!fs.existsSync(ORIG_DB)) throw new Error(`Original DB not found: ${ORIG_DB}`);
  fs.copyFileSync(ORIG_DB, COPY_DB);
  console.log(`[setup] copied -> ${COPY_DB}`);

  // Point the app db client at the copy before importing it.
  process.env.FUNNELS_DB_PATH = COPY_DB;
  const { db } = await import('../src/db/client');
  const { resyncFunnelAvTags } = await import('../src/lib/funnels');

  const raw = new Database(COPY_DB);

  // 1. Rename the broken override (idempotent — no-op if already renamed).
  const ids = raw
    .prepare(`SELECT id FROM funnels WHERE num IN (${TARGET_NUMS.join(',')})`)
    .all()
    .map((r: any) => r.id);

  const upd = raw
    .prepare(
      `UPDATE funnel_tag_overrides SET name = ? WHERE name = ? AND funnel_id IN (${ids.join(',')})`,
    )
    .run(NEW, OLD);
  console.log(`[1] overrides renamed «${OLD}» → «${NEW}»: ${upd.changes} row(s)`);

  // Also fix any lingering raw text fields (export path) just in case.
  for (const col of ['tag_19_raw', 'tag_15_raw', 'reg_tags_raw']) {
    raw
      .prepare(
        `UPDATE funnels SET ${col} = REPLACE(${col}, ?, ?) WHERE num IN (${TARGET_NUMS.join(',')}) AND ${col} LIKE ?`,
      )
      .run(OLD, NEW, `%${OLD}%`);
  }

  // 2. Re-materialize funnel_tags for each funnel through the app logic.
  for (const id of ids) {
    const ok = resyncFunnelAvTags(db, id);
    console.log(`[2] resyncFunnelAvTags(${id}) -> ${ok}`);
  }

  // 3. Drop the orphaned «тег: БОО» tag if nothing references it anymore.
  const stillUsed = raw
    .prepare(
      `SELECT COUNT(*) c FROM funnel_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?)`,
    )
    .get(OLD) as any;
  if (stillUsed && stillUsed.c === 0) {
    const del = raw.prepare(`DELETE FROM tags WHERE name = ?`).run(OLD);
    console.log(`[3] orphaned tag «${OLD}» deleted: ${del.changes} row(s)`);
  } else {
    console.log(`[3] tag «${OLD}» still referenced (${stillUsed?.c}) — not deleted`);
  }

  // 4. Verify.
  console.log('\n=== VERIFY funnel_tags time_19 for num6/24 (payment) ===');
  for (const num of [6, 24]) {
    const rows = raw
      .prepare(
        `SELECT t.name FROM funnel_tags ft JOIN tags t ON t.id=ft.tag_id
         JOIN funnels f ON f.id=ft.funnel_id
         WHERE f.num=? AND ft.tag_type='time_19' ORDER BY ft.position`,
      )
      .all(num)
      .map((r: any) => r.name);
    console.log(`num${num} time_19: ${JSON.stringify(rows)}`);
  }
  const leftover = raw
    .prepare(`SELECT COUNT(*) c FROM funnel_tags ft JOIN tags t ON t.id=ft.tag_id WHERE t.name=?`)
    .get(OLD) as any;
  console.log(`\nfunnel_tags still referencing «${OLD}»: ${leftover.c} (expect 0)`);

  raw.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
