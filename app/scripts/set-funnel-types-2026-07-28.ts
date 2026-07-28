/**
 * Пятая ось: проставить тип двенадцати воронкам и убрать маркер из живого
 * шаблона. Порядок внутри скрипта обязателен — сначала шаблон, потом типы:
 * фаза 7 уже проставила всем «АВ Автоворонка», поэтому чистка шаблона ничего
 * не теряет; в обратном порядке воронки на время остались бы без маркера.
 *
 * Одиннадцать воронок линейки ЖИВО-* → «АВ Прямые»: у их связок в реестре
 * GetCourse единственный маркер именно такой, и в базе у всех одиннадцать
 * нет ни дней, ни лендингов. f43 → «АВ Квиз»: её связка ЖИВО/НИМБ/Яндекс/РСЯ
 * несёт три маркера, и f43 — та из двух воронок, что квизовая.
 *
 * f8, f12, f27 сознательно остаются «АВ Автоворонка»: у всех троих 6 дней
 * и лендинг, в базе лежит вебинарная воронка, а недостающие квиз/прямые —
 * это отдельные воронки, которых в базе нет.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';
import { SCENARIOS } from '../src/lib/ab-tags';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';
import { resyncAllFunnels } from '../src/lib/funnels';
import { SEED_FUNNEL_TYPES } from '../src/lib/funnel-type';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

/** Ожидаемые оси — защита от того, что num или код указывает не туда. */
const TARGETS = [
  { code: 'f43', num: 45, type: 'АВ Квиз',   product: 'ЖИВО',               contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f45', num: 46, type: 'АВ Прямые', product: 'ЖИВО-суставы',       contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f46', num: 47, type: 'АВ Прямые', product: 'ЖИВО-суставы',       contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' },
  { code: 'f47', num: 48, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f48', num: 49, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' },
  { code: 'f51', num: 50, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' },
  { code: 'f54', num: 64, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f55', num: 66, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f56', num: 67, type: 'АВ Прямые', product: 'ЖИВО-суставы',       contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f57', num: 68, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
  { code: 'f73', num: 69, type: 'АВ Прямые', product: 'ЖИВО-суставы-триал', contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' },
  { code: 'f74', num: 70, type: 'АВ Прямые', product: 'ЖИВО-ЖКТ',           contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

function axesMismatch(id: number, want: (typeof TARGETS)[number]): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((axis) => full.axes[axis] !== want[axis])
    .map((axis) => `${axis}: «${full.axes[axis] || '—'}» вместо «${want[axis]}»`);
}

async function main() {
  const prodList = await (await fetch(`${PROD}/api/funnels`)).json() as { num: number }[];
  console.log(`Прод: ${prodList.length} воронок. Локально: `
    + `${db.select({ id: funnels.id }).from(funnels).all().length}.\n`);

  // Шаг 1 — живой шаблон.
  const markers = new Set(SEED_FUNNEL_TYPES);
  for (const scenario of SCENARIOS) {
    const current = listTemplate(db)[scenario] ?? [];
    const cleaned = current.filter((n) => !markers.has(n));
    if (cleaned.length === current.length) {
      console.log(`  = шаблон ${scenario}: маркера нет`);
    } else if (dryRun) {
      console.log(`  - шаблон ${scenario}: убрать ${current.filter((n) => markers.has(n)).join(', ')}`);
    } else {
      db.transaction((tx) => {
        replaceTemplateScenario(tx, scenario, cleaned);
        resyncAllFunnels(tx);
      });
      console.log(`  ✓ шаблон ${scenario} очищен`);
    }
  }

  // Шаг 2 — типы.
  for (const want of TARGETS) {
    const row = db.select({ id: funnels.id, code: funnels.frontCode })
      .from(funnels).where(eq(funnels.num, want.num)).get();
    if (!row) { console.error(`  ! num=${want.num} локально не найдена — пропускаю`); continue; }
    if (row.code !== want.code) {
      console.error(`  ! num=${want.num}: код «${row.code}» вместо «${want.code}» — пропускаю`);
      continue;
    }
    const mismatch = axesMismatch(row.id, want);
    if (mismatch.length) {
      console.error(`  ! ${want.code} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const current = getFunnel(db, row.id)?.funnelType ?? null;
    if (current === want.type) {
      console.log(`  = ${want.code} уже «${want.type}»`);
    } else if (dryRun) {
      console.log(`  - ${want.code}: «${current ?? '—'}» → «${want.type}»`);
    } else {
      updateFunnel(db, row.id, { funnelType: want.type });
      console.log(`  ✓ ${want.code}: «${current ?? '—'}» → «${want.type}»`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
