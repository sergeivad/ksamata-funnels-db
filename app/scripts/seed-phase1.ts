/**
 * Phase-1 seed: add 3 new products + 6 skeleton funnels (num 33–38).
 *
 * "Skeleton" means: identity fields + AV tags only; no funnel_days.
 * Idempotent: a funnel whose `num` already exists is silently skipped.
 *
 * Run against the real DB:
 *   cd app/
 *   npx tsx scripts/seed-phase1.ts
 */
import { type DB } from '../src/db/client';
import { createFunnel } from '../src/lib/funnels';
import { ConflictError } from '../src/lib/errors';
import { type FunnelCreate } from '../src/lib/validation';

// ─── Funnel definitions ───────────────────────────────────────────────────────

const SEED_FUNNELS: FunnelCreate[] = [
  {
    num:         33,
    frontCode:   'f32',
    product:     'СУСТАВЫ',
    contractor:  'НИМБ',
    channel:     'Яндекс',
    direction:   'РСЯ',
    sourceName:  'Яндекс РСЯ',
    status:      'active',
    productName: 'СУСТАВЫ НИМБ РСЯ',
    variant:     '',
    startDate:   '',
    blockName:   '',
  },
  {
    num:         34,
    frontCode:   'f33',
    product:     'ЖИВО',
    contractor:  'НИМБ',
    channel:     'Яндекс',
    direction:   'РСЯ',
    sourceName:  'Яндекс РСЯ',
    status:      'active',
    productName: 'ЖИВО НИМБ РСЯ',
    variant:     '',
    startDate:   '',
    blockName:   '',
  },
  {
    num:         35,
    frontCode:   'f34',
    product:     'ТКМ',
    contractor:  'НИМБ',
    channel:     'Яндекс',
    direction:   'РСЯ',
    sourceName:  'Яндекс РСЯ',
    status:      'draft',
    productName: 'ТКМ НИМБ РСЯ',
    variant:     '',
    startDate:   '',
    blockName:   '',
  },
  {
    num:         36,
    frontCode:   'f27',
    product:     'ЖИВО',
    contractor:  'NR',
    channel:     'ВК',
    direction:   'Реклама',
    sourceName:  'ВК NR',
    status:      'active',
    productName: 'ЖИВО NR ВК',
    variant:     '',
    startDate:   '',
    blockName:   '',
  },
  {
    num:         37,
    frontCode:   'f29',
    product:     'СВС',
    contractor:  'НИМБ',
    channel:     'ВК',
    direction:   'Реклама',
    sourceName:  'ВК НИМБ',
    status:      'active',
    productName: 'СВС НИМБ ВК',
    variant:     '',
    startDate:   '',
    blockName:   '',
  },
  {
    num:         38,
    frontCode:   'f30',
    product:     'ДЫХАНИЕ',
    contractor:  'FAQ',
    channel:     'ВК',
    direction:   'Реклама',
    sourceName:  'ВК FAQ',
    status:      'active',
    productName: 'ДЫХАНИЕ FAQ ВК',
    variant:     '',
    startDate:   '',
    blockName:   '',
  },
];

// ─── Core function (injectable DB for testing) ─────────────────────────────────

export function runSeed(db: DB): void {
  let created = 0;
  let skipped = 0;

  for (const funnel of SEED_FUNNELS) {
    try {
      createFunnel(db, funnel);
      created++;
      console.log(`  Created num=${funnel.num} "${funnel.productName}"`);
    } catch (err) {
      // Идемпотентность сева держится ровно на этом различении: «такая воронка
      // уже есть» — не ошибка, всё остальное — ошибка. Раньше оно опиралось на
      // префикс текста «409:», то есть ломалось от переформулировки сообщения.
      if (err instanceof ConflictError) {
        skipped++;
        console.log(`  Skipped num=${funnel.num} (already exists)`);
      } else {
        throw err;
      }
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}`);
}

// ─── CLI entry point ───────────────────────────────────────────────────────────
// Run with:  npx tsx scripts/seed-phase1.ts   (from app/)
if (require.main === module) {
  // Import real DB client lazily so the module can also be used as a library.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require('../src/db/client');
  console.log('Phase-1 seed: inserting 3 new products + 6 skeleton funnels...\n');
  runSeed(db);
}
