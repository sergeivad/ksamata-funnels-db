/**
 * Phase 2b — apply through APPLICATION LOGIC (createFunnel/updateFunnel), not
 * raw SQL, so that `funnel_tags` (source of truth for the GUI) is populated
 * exactly the way the app itself would populate it.
 *
 * PART 1: create 12 new funnels (num 40-51) via createFunnel().
 * PART 2: seed webinar rooms (funnel_days) for num40 (f35) only.
 * PART 3: fix num16 (→ archive, NR/In Stream) and num20 (→ ИНХАУЗ) via updateFunnel().
 *
 * Raw legacy export columns (tag_19_raw / tag_15_raw / reg_tags_raw) and
 * funnel_days are NOT covered by createFunnel/updateFunnel — those are
 * written directly with a second better-sqlite3 connection onto the same
 * file, mirroring what a Python export step would have produced.
 *
 * SAFETY: this script NEVER touches the original DB. It copies the original
 * into the scratchpad (once — reused on re-run for idempotency) and points
 * FUNNELS_DB_PATH at the copy BEFORE importing the db client singleton
 * (client.ts reads FUNNELS_DB_PATH at import time), via dynamic import().
 *
 * Run:
 *   cd app && npx tsx scripts/apply_phase2b.ts
 */

import fs from 'fs';
import path from 'path';

// ─── 0. Resolve paths & point FUNNELS_DB_PATH at a throwaway copy ────────────

const APP_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');
const ORIG_DB_PATH = path.resolve(REPO_ROOT, 'ksamata_funnels.db');

const SCRATCHPAD_DIR =
  process.env.SCRATCHPAD_DIR ??
  '/private/tmp/claude-501/-Users-sergeielkin-dev-ksamata-Ksamata-ksamata-funnels-db/297da5fd-65d9-41bb-9a0b-a421b21610bc/scratchpad';

const COPY_DB_PATH = path.join(SCRATCHPAD_DIR, 'ksamata_funnels.phase2b_ts.db');

if (!fs.existsSync(ORIG_DB_PATH)) {
  throw new Error(`Original DB not found at ${ORIG_DB_PATH} — refusing to continue.`);
}

if (!fs.existsSync(COPY_DB_PATH)) {
  fs.copyFileSync(ORIG_DB_PATH, COPY_DB_PATH);
  console.log(`[setup] Copied original DB -> ${COPY_DB_PATH}`);
} else {
  console.log(`[setup] Reusing existing copy at ${COPY_DB_PATH} (idempotent re-run)`);
}

// MUST happen before any import of ../src/db/client (singleton reads this at
// module-eval time). Everything below uses dynamic import() for that reason.
process.env.FUNNELS_DB_PATH = COPY_DB_PATH;
console.log(`[setup] FUNNELS_DB_PATH = ${process.env.FUNNELS_DB_PATH}`);
console.log(`[setup] Original DB (untouched) = ${ORIG_DB_PATH}`);

// ─── Types for the Phase 2b data tables (mirrors SPEC_phase2b_ts.md) ─────────

type Status = 'active' | 'draft' | 'archive';

type NewFunnelSpec = {
  num: number;
  frontCode: string;
  product: string;
  contractor: string;
  channel: string;
  direction: string;
  sourceName: string;
  variant: string;
  status: Status;
  productName: string;
  /** extra "legacy" head token prepended to raw tag strings; null = none */
  extraRaw: string | null;
};

// ─── PART 1 data — 12 new funnels (exact per SPEC table) ─────────────────────

const NEW_FUNNELS: NewFunnelSpec[] = [
  { num: 40, frontCode: 'f35', product: 'СУСТАВЫ',              contractor: 'NR',      channel: 'ВК',     direction: 'Реклама', sourceName: 'ВК NR',                variant: '',              status: 'active', productName: 'СУСТАВЫ NR ВК',              extraRaw: null },
  { num: 41, frontCode: 'f39', product: 'ДБО',                  contractor: 'НИМБ',    channel: 'Сайт',   direction: 'СЕО',     sourceName: 'Сайт СЕО',             variant: '',              status: 'active', productName: 'ДБО НИМБ Сайт',              extraRaw: null },
  { num: 42, frontCode: 'f40', product: 'СВС',                  contractor: 'НИМБ',    channel: 'Сайт',   direction: 'СЕО',     sourceName: 'Сайт СЕО',             variant: '',              status: 'active', productName: 'СВС НИМБ Сайт',              extraRaw: null },
  { num: 43, frontCode: 'f41', product: 'ДБО',                  contractor: 'Партнёр', channel: 'Партнёры', direction: 'Партнёрский трафик', sourceName: 'Партнёры', variant: '',           status: 'active', productName: 'ДБО Партнёр Партнёры',       extraRaw: null },
  { num: 44, frontCode: 'f42', product: 'ЖКТ-4вр',               contractor: 'НИМБ',    channel: 'Яндекс', direction: 'РСЯ',     sourceName: 'Яндекс РСЯ',           variant: '4вр',           status: 'active', productName: 'ЖКТ-4вр НИМБ Яндекс',        extraRaw: null },
  { num: 45, frontCode: 'f43', product: 'ЖИВО',                  contractor: 'НИМБ',    channel: 'Яндекс', direction: 'РСЯ',     sourceName: 'Яндекс Реклама квиз',  variant: 'квиз',          status: 'active', productName: 'КВИЗЫ ЖИВО НИМБ',            extraRaw: 'квиз' },
  { num: 46, frontCode: 'f45', product: 'ЖИВО-суставы',          contractor: 'НИМБ',    channel: 'Яндекс', direction: 'РСЯ',     sourceName: 'Яндекс РСЯ',           variant: 'суставы',       status: 'active', productName: 'ЖИВО-суставы НИМБ Яндекс',   extraRaw: null },
  { num: 47, frontCode: 'f46', product: 'ЖИВО-суставы',          contractor: 'ИНХАУЗ',  channel: 'ВК',     direction: 'Реклама', sourceName: 'ВК ИНХАУЗ',            variant: 'суставы',       status: 'active', productName: 'ЖИВО-суставы ИНХАУЗ ВК',     extraRaw: null },
  { num: 48, frontCode: 'f47', product: 'ЖИВО-суставы-триал',    contractor: 'НИМБ',    channel: 'Яндекс', direction: 'РСЯ',     sourceName: 'Яндекс РСЯ',           variant: 'суставы-триал', status: 'draft',  productName: 'ЖИВО-суставы-триал НИМБ',    extraRaw: null },
  { num: 49, frontCode: 'f48', product: 'ЖИВО-ЖКТ',              contractor: 'ИНХАУЗ',  channel: 'ВК',     direction: 'Реклама', sourceName: 'ВК ИНХАУЗ',            variant: 'ЖКТ',           status: 'active', productName: 'ЖИВО-ЖКТ ИНХАУЗ ВК',         extraRaw: null },
  { num: 50, frontCode: 'f51', product: 'ЖИВО-суставы-триал',    contractor: 'ИНХАУЗ',  channel: 'ВК',     direction: 'Реклама', sourceName: 'ВК ИНХАУЗ',            variant: 'суставы-триал', status: 'draft',  productName: 'ЖИВО-суставы-триал ИНХАУЗ',  extraRaw: null },
  { num: 51, frontCode: 'f52', product: 'ДЫХАНИЕ',               contractor: 'ИНХАУЗ',  channel: 'ВК',     direction: 'Реклама', sourceName: 'ВК ИНХАУЗ',            variant: '',              status: 'draft',  productName: 'ДЫХАНИЕ ИНХАУЗ ВК',          extraRaw: null },
];

// Reg-offer strings from leak_rules.json (`o`), keyed by frontCode — used
// verbatim (joined with '; ') as the `comment` field for reference only.
const LEAK_REG_OFFERS: Record<string, string[]> = {
  f35: ['Регистрация на суставы [ВК NR]'],
  f39: ['Регистрация на вебинар РАДОСТЬ ДВИЖЕНИЯ [Short RD Сайт]'],
  f40: ['Регистрация на СВС [сайт]', 'Регистрация на СВС (сайт)'],
  f41: [
    'Регистрация на ЧУДЕСНОЕ ОМОЛОЖЕНИЕ [Short CHO партнеры]',
    'Регистрация на вебинар РАДОСТЬ ДВИЖЕНИЯ [Short RD партнеры]',
    'Регистрация на Детокс [Short Detox партнеры]',
  ],
  f42: ['Регистрация на ЖКТ [ЖКТ-4вр РСЯ]'],
  f43: [],
  f45: [],
  f46: [],
  f47: [],
  f48: [],
  f51: [],
  f52: ['Регистрация на ДЫХАНИЕ (FAQ ВК)'],
};

// ─── PART 2 data — rooms for num40 (f35) only, from leak_rules.json `r` ──────
// 10 codes, 19-slot days 1-5 then 15-slot days 1-5 (already in that order).
const ROOMS_NUM40: string[] = [
  'sst1-19-nr', 'sst2-19-nr', 'sst3-19-nr', 'sst4-19-nr', 'sst5-19-nr',
  'sst1-15-nr', 'sst2-15-nr', 'sst3-15-nr', 'sst4-15-nr', 'sst5-15-nr',
];

// ─── build_tags helper (canon formula from SPEC, ЧАСТЬ1/num33-38 pattern) ────

function buildTags(P: string, K: string, N: string, C: string, extra: string | null = null) {
  const head = extra ? [extra] : [];
  const tag19 = [
    ...head, 'АВ Автоворонка', 'АВ Этап: Оплата',
    `АВ Продукт: ${P}`, `АВ Канал: ${K}`, `АВ Направление: ${N}`, `АВ Подрядчик: ${C}`,
    't=19', 'АВ Время: 19',
  ].join(', ');
  const tag15 = [
    ...head, 'АВ Автоворонка', 'АВ Этап: Оплата',
    `АВ Продукт: ${P}`, `АВ Канал: ${K}`, `АВ Направление: ${N}`, `АВ Подрядчик: ${C}`,
    't=15', 'АВ Время: 15',
  ].join(', ');
  const reg = [
    'Регистрация', ...head, 'АВ Автоворонка', 'АВ Этап: Регистрация',
    `АВ Продукт: ${P}`, `АВ Канал: ${K}`, `АВ Направление: ${N}`, `АВ Подрядчик: ${C}`,
  ].join(', ');
  return { tag19, tag15, reg };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Import AFTER FUNNELS_DB_PATH is set, so the db client singleton opens the copy.
  const { db } = await import('../src/db/client');
  const { createFunnel, updateFunnel, resyncFunnelAvTags } = await import('../src/lib/funnels');
  const { funnels } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const BetterSqlite3 = (await import('better-sqlite3')).default;

  // Second, independent connection to the SAME file, used only for raw-column
  // UPDATEs and funnel_days INSERTs that createFunnel/updateFunnel don't cover.
  const raw = new BetterSqlite3(COPY_DB_PATH);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const findByNum = (num: number): { id: number } | undefined =>
    db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, num)).get();

  // ── PART 1: 12 new funnels via createFunnel() ──────────────────────────────
  console.log('\n=== PART 1: creating new funnels via createFunnel() ===');
  const createdNums: number[] = [];
  const skippedNums: number[] = [];

  for (const spec of NEW_FUNNELS) {
    const existing = findByNum(spec.num);
    if (existing) {
      console.log(`[SKIP] num=${spec.num} (${spec.frontCode}) already exists (id=${existing.id})`);
      skippedNums.push(spec.num);
      continue;
    }

    const comment = (LEAK_REG_OFFERS[spec.frontCode] ?? []).join('; ');

    let created;
    try {
      created = createFunnel(db, {
        num: spec.num,
        frontCode: spec.frontCode,
        status: spec.status,
        productName: spec.productName,
        variant: spec.variant,
        landingUrl: '',
        startDate: '',
        blockName: '',
        product: spec.product,
        contractor: spec.contractor,
        channel: spec.channel,
        direction: spec.direction,
        sourceName: spec.sourceName,
        comment,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('409')) {
        console.log(`[SKIP] num=${spec.num} (${spec.frontCode}) — createFunnel reported 409 (race?)`);
        skippedNums.push(spec.num);
        continue;
      }
      throw err;
    }

    console.log(
      `[CREATED] num=${created.num} frontCode=${created.frontCode} id=${created.id} ` +
      `axes={product:"${created.axes.product}", contractor:"${created.axes.contractor}", ` +
      `channel:"${created.axes.channel}", direction:"${created.axes.direction}"} status=${spec.status}`
    );
    createdNums.push(created.num);

    // Raw legacy columns (Python-export mirror), via the second connection.
    const { tag19, tag15, reg } = buildTags(spec.product, spec.channel, spec.direction, spec.contractor, spec.extraRaw);
    raw.prepare(
      `UPDATE funnels SET tag_19_raw = ?, tag_15_raw = ?, reg_tags_raw = ? WHERE num = ?`
    ).run(tag19, tag15, reg, spec.num);
    console.log(`  raw: tag_19_raw="${tag19}"`);
    console.log(`  raw: tag_15_raw="${tag15}"`);
    console.log(`  raw: reg_tags_raw="${reg}"`);
  }

  // ── PART 2: rooms for num40 (f35) only ──────────────────────────────────────
  console.log('\n=== PART 2: webinar rooms for num40 (f35) ===');
  const f35 = findByNum(40);
  if (!f35) {
    console.log('[WARN] num=40 not found — skipping rooms (f42/f52 rooms intentionally skipped per SPEC).');
  } else {
    const funnelId = f35.id;
    const dayCount = raw.prepare(`SELECT COUNT(*) AS c FROM funnel_days WHERE funnel_id = ?`).get(funnelId) as { c: number };
    if (dayCount.c > 0) {
      console.log(`[SKIP] funnel_days for num=40 already has ${dayCount.c} rows — not duplicating.`);
    } else {
      // room_ids_json = { d{day}_{slot}: code }, built from the same 10 codes.
      const roomIdsJson: Record<string, string> = {};
      const insertDay = raw.prepare(
        `INSERT INTO funnel_days (funnel_id, time_slot, day_num, gc_room, web_room) VALUES (?, ?, ?, ?, ?)`
      );
      const insertMany = raw.transaction((codes: string[]) => {
        for (const code of codes) {
          const m = /^[a-z0-9]+?(\d)-(19|15)-[a-z0-9]+$/.exec(code);
          if (!m) throw new Error(`Room code "${code}" doesn't match expected pattern`);
          const day = Number(m[1]);
          const slot = m[2] as '19' | '15';
          roomIdsJson[`d${day}_${slot}`] = code;
          const gc = `https://gc.ksamata.ru/${code}`;
          const web = `https://web.ksamatacenter.com/room/${code}`;
          insertDay.run(funnelId, slot, day, gc, web);
        }
      });
      insertMany(ROOMS_NUM40);
      raw.prepare(`UPDATE funnels SET room_ids_json = ? WHERE id = ?`).run(JSON.stringify(roomIdsJson), funnelId);
      console.log(`[OK] inserted ${ROOMS_NUM40.length} funnel_days rows for num=40, room_ids_json set.`);
    }
  }
  console.log('[NOTE] f42 (num44) and f52 (num51) rooms intentionally skipped — leak codes ambiguous/contradictory per SPEC.');

  // ── PART 3: num16 / num20 via updateFunnel() ────────────────────────────────
  console.log('\n=== PART 3: fixing num16 / num20 via updateFunnel() ===');

  const f16 = findByNum(16);
  if (!f16) {
    console.log('[WARN] num=16 not found — skipping.');
  } else {
    const updated16 = updateFunnel(db, f16.id, {
      status: 'archive',
      product: 'БОО',
      contractor: 'NR',
      channel: 'ВК',
      direction: 'In Stream',
    });
    console.log(
      `[UPDATED] num=16 id=${f16.id} status=${updated16?.status} ` +
      `axes=${JSON.stringify(updated16?.axes)}`
    );

    // Legacy raw strings, confirmed with user in SPEC_phase2b.md (NOT the
    // generic build_tags formula — this funnel carries pre-AV legacy tokens).
    const tag19_16 = 'БОО, ВК NR, IS NR, t=19, АВ Автоворонка, АВ Этап: Оплата, АВ Продукт: БОО, АВ Канал: ВК, АВ Направление: In Stream, АВ Подрядчик: NR, АВ Время: 19';
    const tag15_16 = 'БОО, ВК NR, IS NR, t=15, АВ Автоворонка, АВ Этап: Оплата, АВ Продукт: БОО, АВ Канал: ВК, АВ Направление: In Stream, АВ Подрядчик: NR, АВ Время: 15';
    const reg_16   = 'Регистрация, Детокс, ВК NR IS, ВК NR, АВ Автоворонка, АВ Этап: Регистрация, АВ Продукт: БОО, АВ Канал: ВК, АВ Направление: In Stream, АВ Подрядчик: NR';
    raw.prepare(`UPDATE funnels SET tag_19_raw = ?, tag_15_raw = ?, reg_tags_raw = ? WHERE num = 16`)
      .run(tag19_16, tag15_16, reg_16);
    console.log(`  raw: tag_19_raw="${tag19_16}"`);
    console.log(`  raw: tag_15_raw="${tag15_16}"`);
    console.log(`  raw: reg_tags_raw="${reg_16}"`);
  }

  const f20 = findByNum(20);
  if (!f20) {
    console.log('[WARN] num=20 not found — skipping.');
  } else {
    const updated20 = updateFunnel(db, f20.id, {
      product: 'БОО',
      contractor: 'ИНХАУЗ',
      channel: 'ВК',
      direction: 'Реклама',
      productName: 'БОО ВК ИНХАУЗ',
    });
    console.log(
      `[UPDATED] num=20 id=${f20.id} productName=${updated20?.productName} ` +
      `axes=${JSON.stringify(updated20?.axes)}`
    );

    const { tag19: tag19_20, tag15: tag15_20, reg: reg_20 } = buildTags('БОО', 'ВК', 'Реклама', 'ИНХАУЗ');
    raw.prepare(`UPDATE funnels SET tag_19_raw = ?, tag_15_raw = ?, reg_tags_raw = ? WHERE num = 20`)
      .run(tag19_20, tag15_20, reg_20);
    console.log(`  raw: tag_19_raw="${tag19_20}"`);
    console.log(`  raw: tag_15_raw="${tag15_20}"`);
    console.log(`  raw: reg_tags_raw="${reg_20}"`);
  }

  // ── PART 4: strip junk custom override tags from num16 / num20 ─────────────
  // These are leftover per-funnel `op='add'` overrides ("ВК БАИНГ" — stale,
  // "Яндекс Холодный квиз CHO" — junk) that survived the axis rewrite in
  // PART 3 (materializeFunnelTags always preserves existing overrides).
  // Legitimate custom adds (Детокс, ВК, БОО, Регистрация) are left alone.
  console.log('\n=== PART 4: cleaning up junk override tags for num16/num20 ===');
  const junkOverrideDelete = raw.prepare(
    `DELETE FROM funnel_tag_overrides
       WHERE funnel_id IN (SELECT id FROM funnels WHERE num IN (16, 20))
         AND op = 'add'
         AND name IN ('ВК БАИНГ', 'Яндекс Холодный квиз CHO')`
  );
  const junkDeleteResult = junkOverrideDelete.run();
  console.log(`[OK] deleted ${junkDeleteResult.changes} junk override row(s) ("ВК БАИНГ" / "Яндекс Холодный квиз CHO") — idempotent, safe to re-run.`);

  if (f16) {
    const resynced16 = resyncFunnelAvTags(db, f16.id);
    console.log(`[RESYNC] num=16 id=${f16.id} resyncFunnelAvTags -> ${resynced16} (rebuilt funnel_tags from axes + template + remaining overrides)`);
  }
  if (f20) {
    const resynced20 = resyncFunnelAvTags(db, f20.id);
    console.log(`[RESYNC] num=20 id=${f20.id} resyncFunnelAvTags -> ${resynced20} (rebuilt funnel_tags from axes + template + remaining overrides)`);
  }

  // ── Verification SELECTs ────────────────────────────────────────────────────
  console.log('\n=== VERIFICATION ===');

  const printFunnelTags = (num: number, tagTypes: readonly ('reg' | 'time_19' | 'time_15')[] = ['reg', 'time_19']) => {
    console.log(`\n-- funnel_tags for num=${num} --`);
    const row = raw.prepare(`SELECT id FROM funnels WHERE num = ?`).get(num) as { id: number } | undefined;
    if (!row) {
      console.log(`  (no funnel with num=${num})`);
      return;
    }
    for (const tagType of tagTypes) {
      const rows = raw.prepare(
        `SELECT t.name AS name
           FROM funnel_tags ft
           JOIN tags t ON t.id = ft.tag_id
          WHERE ft.funnel_id = ? AND ft.tag_type = ?
          ORDER BY ft.position`
      ).all(row.id, tagType) as { name: string }[];
      console.log(`  ${tagType}: [${rows.map((r) => `"${r.name}"`).join(', ')}]`);
    }
  };

  printFunnelTags(40);
  printFunnelTags(16, ['reg', 'time_19', 'time_15']);
  printFunnelTags(20, ['reg', 'time_19', 'time_15']);

  const daysCount40 = raw.prepare(`SELECT COUNT(*) AS c FROM funnel_days fd JOIN funnels f ON f.id = fd.funnel_id WHERE f.num = 40`).get() as { c: number };
  console.log(`\nfunnel_days count for num=40: ${daysCount40.c}`);

  console.log('\n-- num/front_code/status/product_id/contractor_id for num16, num20, num40-51 --');
  const nums = [16, 20, ...Array.from({ length: 12 }, (_, i) => 40 + i)];
  const placeholders = nums.map(() => '?').join(',');
  const listRows = raw.prepare(
    `SELECT num, front_code, status, product_id, contractor_id FROM funnels WHERE num IN (${placeholders}) ORDER BY num`
  ).all(...nums) as { num: number; front_code: string; status: string; product_id: number; contractor_id: number }[];
  for (const r of listRows) {
    console.log(`  num=${r.num} front_code=${r.front_code} status=${r.status} product_id=${r.product_id} contractor_id=${r.contractor_id}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Created: [${createdNums.join(', ')}]`);
  console.log(`Skipped (already existed): [${skippedNums.join(', ')}]`);

  raw.close();
}

main()
  .then(() => {
    console.log('\n[DONE] apply_phase2b.ts finished successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[FATAL]', err);
    process.exit(1);
  });
