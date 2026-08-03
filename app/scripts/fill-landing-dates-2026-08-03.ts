/**
 * One-off (2026-08-03): fill `landing_url` / `start_date` for a fixed set of
 * existing funnels, using data handed down by the owner (see task data in
 * docs — this script is not meant to be reused for a different batch).
 *
 * Rules:
 *   - Only through app logic: `getFunnel`/`updateFunnel` from
 *     `../src/lib/funnels.ts`. No raw SQL against `funnels`.
 *   - Idempotent: writes `landing_url` only if currently empty, `start_date`
 *     only if currently empty. A non-empty field is left untouched and logged
 *     as a skip. Safe to run twice.
 *   - Identity check before writing: each row names the funnel's expected
 *     `front_code`; a mismatch aborts that row (logs an error) without
 *     touching it, and the run continues with the rest. Expected source/
 *     product are looked up and printed for visual confirmation (per the
 *     task, only front_code is a hard gate).
 *   - Never touches status/front_code/num/axes/rooms/blocks/tags — the patch
 *     object only ever contains landingUrl and/or startDate.
 *
 * Run from app/:
 *   npx tsx scripts/fill-landing-dates-2026-08-03.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { getFunnel, updateFunnel } from '../src/lib/funnels';
import { sources } from '../src/db/schema';
import { type FunnelUpdate } from '../src/lib/validation';

type Row = {
  id: number;
  frontCode: string;
  expectedSource: string;
  expectedProduct: string;
  landingUrl?: string;
  startDate?: string;
};

const ROWS: Row[] = [
  { id: 33, frontCode: 'f32', expectedSource: 'Яндекс РСЯ', expectedProduct: 'СУСТАВЫ',
    landingUrl: 'https://t.sust-bez-problem.ru/sust/rsya/a', startDate: '2026-06-04' },
  { id: 47, frontCode: 'f45', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО-суставы',
    landingUrl: 'https://t.sustavy-start.ru/jivo/trial/nimb/a', startDate: '2026-07-10' },
  // Строка 23 таблицы владельца помечена «F46», но это опечатка: ЛИК отдаёт
  // f47 = «ЖИВО-суставы-триал / НИМБ / Яндекс / РСЯ», а f46 — воронку ИНХАУЗ/ВК
  // (строка 60). Сверено 2026-08-04 через /app-api/api/admin/funnels.
  { id: 49, frontCode: 'f47', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО-суставы-триал',
    landingUrl: 'http://t.sustavy-legko.ru/trial/nimb/a', startDate: '2026-07-27' },
  { id: 65, frontCode: 'f54', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО-ЖКТ',
    landingUrl: 'https://t.zabota-o-zhkt.ru/jivo/trial/zhkt/nimb/a', startDate: '2026-07-23' },
  { id: 41, frontCode: 'f35', expectedSource: 'ВК NR', expectedProduct: 'СУСТАВЫ',
    landingUrl: 'https://t.ksamata.ru/sust/nr/a', startDate: '2026-07-01' },
  { id: 52, frontCode: 'f52', expectedSource: 'ВК ИНХАУЗ', expectedProduct: 'ДЫХАНИЕ',
    landingUrl: 'https://t.ksamata.ru/inhaus/dih/a', startDate: '2026-07-21' },
  { id: 50, frontCode: 'f48', expectedSource: 'ВК ИНХАУЗ', expectedProduct: 'ЖИВО-ЖКТ',
    landingUrl: 'https://t.ksamata.ru/jivo/trial/zhkt/inhouse/a', startDate: '2026-07-17' },
  { id: 48, frontCode: 'f46', expectedSource: 'ВК ИНХАУЗ', expectedProduct: 'ЖИВО-суставы',
    landingUrl: 'https://t.ksamata.ru/jivo/trial/inhouse/a', startDate: '2026-07-10' },
  { id: 51, frontCode: 'f51', expectedSource: 'ВК ИНХАУЗ', expectedProduct: 'ЖИВО-суставы-триал',
    landingUrl: 'https://t.ksamata.ru/trial/inhouse/a', startDate: '2026-07-17' },
  { id: 69, frontCode: 'f57', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО-ЖКТ',
    landingUrl: 'https://t.zdravo-telo.ru/rsy/jivo/trial/zhkt/inhouse/a' },
  { id: 67, frontCode: 'f55', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО-суставы-триал',
    landingUrl: 'https://t.zdravo-telo.ru/rsy/trial/inhouse/a' },
  { id: 74, frontCode: 'f80', expectedSource: 'Яндекс РСЯ', expectedProduct: 'СУСТАВЫ',
    landingUrl: 'https://t.ksamata.ru/sust/inhousya/a' },
  { id: 70, frontCode: 'f73', expectedSource: 'ВК NR', expectedProduct: 'ЖИВО-суставы-триал',
    landingUrl: 'https://t.ksamata.ru/trial/nr/a', startDate: '2026-08-01' },
  { id: 71, frontCode: 'f74', expectedSource: 'ВК NR', expectedProduct: 'ЖИВО-ЖКТ',
    landingUrl: 'https://t.ksamata.ru/jivo/trial/zhkt/nr/a', startDate: '2026-08-01' },
  { id: 75, frontCode: 'f78', expectedSource: 'ВК NR', expectedProduct: 'ТКМ',
    landingUrl: 'https://t.ksamata.ru/tkm/nr/a', startDate: '2026-08-01' },
  { id: 59, frontCode: 'f53', expectedSource: 'ВК ИНХАУЗ', expectedProduct: 'СУСТАВЫ',
    landingUrl: 'https://t.ksamata.ru/sust/inhaus/a', startDate: '2026-07-21' },
  { id: 34, frontCode: 'f33', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО',
    startDate: '2026-05-12' },
  { id: 36, frontCode: 'f27', expectedSource: 'ВК NR', expectedProduct: 'ЖИВО',
    startDate: '2026-06-03' },
  { id: 38, frontCode: 'f30', expectedSource: 'ВК FAQ', expectedProduct: 'ДЫХАНИЕ',
    startDate: '2026-06-13' },
  { id: 37, frontCode: 'f29', expectedSource: 'ВК НИМБ', expectedProduct: 'СВС',
    startDate: '2026-04-01' },
  // Двухссылочные — формат " / " как у f7 (см. id=7 в базе).
  { id: 68, frontCode: 'f56', expectedSource: 'Яндекс РСЯ', expectedProduct: 'ЖИВО-суставы',
    landingUrl: 'https://t.zdravo-telo.ru/rsy/jivo/trial/inhouse/a / https://gc.zdravo-telo.ru/jivo/sust/inhouse/a' },
  { id: 78, frontCode: 'f84', expectedSource: 'ВК ИНХАУЗ', expectedProduct: 'ДБО',
    landingUrl: 'https://t.ksamata.ru/inhaus/dbo/a / https://land.ksamata.ru/inhouse/sustavy/a/',
    startDate: '2026-07-29' },
];

function sourceNameById(sourceId: number): string {
  const row = db.select({ name: sources.name }).from(sources).where(eq(sources.id, sourceId)).get() as
    | { name: string }
    | undefined;
  return row?.name ?? '(неизвестно)';
}

function run(): void {
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of ROWS) {
    const funnel = getFunnel(db, row.id);
    if (!funnel) {
      console.log(`id=${row.id} ${row.frontCode}: ОШИБКА — воронка не найдена`);
      errors++;
      continue;
    }

    const actualSource = sourceNameById(funnel.sourceId);
    const actualProduct = funnel.axes.product;

    if (funnel.frontCode !== row.frontCode) {
      console.log(
        `id=${row.id}: ОШИБКА — ожидался front_code=${row.frontCode}, ` +
          `в базе "${funnel.frontCode}" (source="${actualSource}", product="${actualProduct}"). Пропускаю строку.`,
      );
      errors++;
      continue;
    }

    console.log(`id=${row.id} ${funnel.frontCode}: source="${actualSource}", product="${actualProduct}"`);
    if (actualSource !== row.expectedSource) {
      console.log(`  ПРЕДУПРЕЖДЕНИЕ: ожидался source="${row.expectedSource}", в базе "${actualSource}"`);
    }
    if (actualProduct !== row.expectedProduct) {
      console.log(`  ПРЕДУПРЕЖДЕНИЕ: ожидался product="${row.expectedProduct}", в базе "${actualProduct}"`);
    }

    const patch: FunnelUpdate = {};
    const notes: string[] = [];

    if (row.landingUrl !== undefined) {
      if (funnel.landingUrl === '') {
        patch.landingUrl = row.landingUrl;
        notes.push(`landing_url -> ${row.landingUrl}`);
      } else {
        notes.push(`landing_url: skip (уже заполнено: ${funnel.landingUrl})`);
      }
    }

    if (row.startDate !== undefined) {
      if (funnel.startDate === '') {
        patch.startDate = row.startDate;
        notes.push(`start_date -> ${row.startDate}`);
      } else {
        notes.push(`start_date: skip (уже заполнено: ${funnel.startDate})`);
      }
    }

    if (Object.keys(patch).length === 0) {
      console.log(`  SKIP: нечего писать (${notes.join('; ')})`);
      skipped++;
      continue;
    }

    updateFunnel(db, row.id, patch);
    console.log(`  UPDATED: ${notes.join('; ')}`);
    updated++;
  }

  console.log(`\nИтого: обновлено=${updated}, пропущено=${skipped}, ошибок=${errors}`);
}

run();
