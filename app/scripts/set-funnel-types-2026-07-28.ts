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
 * ПРЕДВАРИТЕЛЬНОЕ УСЛОВИЕ: справочник funnel_types и колонка funnel_type_id
 * должны уже существовать (Фаза 7). На проде это делает docker-entrypoint.sh
 * при старте контейнера, но для ручного прогона — по умолчанию и для копии
 * из Step 2/3 — это отдельный шаг, ничего его не делает за вас:
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/migrate-phase7.ts
 * Без него скрипт падает в ОБОИХ режимах: assertNotFunnelTypeMarker (внутри
 * replaceTemplateScenario, --apply) и getFunnelTypeContext (внутри
 * axesMismatch → getFunnel, --dry-run тоже, на первой же цели) читают
 * funnel_types и без миграции получат «no such table».
 *
 * Каждая мутация — своя отдельная транзакция (по одной на сценарий шаблона,
 * одна на общий ресинк тегов, по одной на каждую из двенадцати воронок).
 * Падение на любом шаге останавливает скрипт, но не откатывает уже
 * применённые шаги и не портит недошедшие — уже очищенный сценарий и уже
 * проставленный тип при повторном запуске просто пропускаются с «=».
 *
 * Оговорка: это НЕ гарантия того, что повторный `--apply` всегда доделает
 * работу до конца. Если ресинк (`resyncAllFunnels`) упадёт ПОСЛЕ того, как
 * все четыре сценария шаблона уже очищены (шаг 1 целиком прошёл), повторный
 * прогон увидит шаблон уже чистым — `cleaned.length === current.length` для
 * каждого сценария — и молча пропустит `resyncAllFunnels` вовсе, потому что
 * условие `templateChanged` не взведётся. Тогда часть воронок так и останется
 * с непересчитанными тегами, и скрипт этого не покажет. Проверять это шагом
 * 2 (сводка по маркерам в конце) и сверкой с ожидаемым итогом, а не доверять
 * одной идемпотентности.
 *
 * СТАТУС: к ЛОКАЛЬНОЙ базе (`ksamata_funnels.db` в корне репозитория) скрипт
 * уже применён 2026-07-29 — двенадцать воронок несут актуальный тип, шаблон
 * очищен. Остаётся прогон на проде (`--apply` через публичный API, см. шапку
 * задачи в design-документе, раздел 5. Выкладка).
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/set-funnel-types-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels, funnelTags, tags } from '../src/db/schema';
import { getFunnel, updateFunnel, resyncAllFunnels } from '../src/lib/funnels';
import { SCENARIOS } from '../src/lib/ab-tags';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';
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

/**
 * Число воронок на проде — только для справки в шапке вывода, ни на что не
 * влияет. Задача прямо запрещает скрипту трогать прод, поэтому недоступный
 * прод (сеть, авторизация, временная недоступность) не должен валить прогон
 * по локальной копии — предупреждаем и продолжаем без этой строки.
 */
async function prodFunnelCount(): Promise<number | null> {
  try {
    const res = await fetch(`${PROD}/api/funnels`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json() as { num: number }[];
    return list.length;
  } catch (err) {
    console.error(`  ! прод недоступен, счётчик пропущен: ${(err as Error).message}`);
    return null;
  }
}

/** Итоговая сводка по маркерам — та самая проверка, что раньше делалась отдельным sqlite3-запросом руками. */
function printMarkerSummary(): void {
  const rows = db
    .select({ funnelId: funnelTags.funnelId, name: tags.name })
    .from(funnelTags)
    .innerJoin(tags, eq(tags.id, funnelTags.tagId))
    .all() as { funnelId: number; name: string }[];

  const byMarker = new Map<string, Set<number>>();
  for (const name of SEED_FUNNEL_TYPES) byMarker.set(name, new Set());
  for (const row of rows) {
    if (byMarker.has(row.name)) byMarker.get(row.name)!.add(row.funnelId);
  }

  console.log('\nИтог по маркерам типа:');
  for (const name of SEED_FUNNEL_TYPES) {
    console.log(`  ${name}: ${byMarker.get(name)!.size}`);
  }
}

async function main() {
  const prodCount = await prodFunnelCount();
  const prodLine = prodCount === null ? 'прод: н/д' : `прод: ${prodCount} воронок`;
  console.log(`${prodLine}. Локально: `
    + `${db.select({ id: funnels.id }).from(funnels).all().length}.\n`);

  // Шаг 1 — живой шаблон. Сперва чистим все сценарии по отдельности (каждый
  // replaceTemplateScenario — своя транзакция), и только потом один общий
  // resyncAllFunnels — а не по разу на сценарий, как раньше: ресинк
  // пересчитывает теги ВСЕХ воронок по ВСЕМ сценариям разом, так что четыре
  // прогона подряд повторяли одну и ту же работу трижды впустую.
  const markers = new Set(SEED_FUNNEL_TYPES);
  let templateChanged = false;
  for (const scenario of SCENARIOS) {
    const current = listTemplate(db)[scenario] ?? [];
    const cleaned = current.filter((n) => !markers.has(n));
    if (cleaned.length === current.length) {
      console.log(`  = шаблон ${scenario}: маркера нет`);
    } else if (dryRun) {
      console.log(`  - шаблон ${scenario}: убрать ${current.filter((n) => markers.has(n)).join(', ')}`);
    } else {
      replaceTemplateScenario(db, scenario, cleaned);
      templateChanged = true;
      console.log(`  ✓ шаблон ${scenario} очищен`);
    }
  }
  if (templateChanged) {
    resyncAllFunnels(db);
    console.log('  ✓ теги всех воронок пересчитаны по очищенному шаблону');
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

  if (!dryRun) printMarkerSummary();
}

main().catch((err) => { console.error(err); process.exit(1); });
