/**
 * ЦЕЛЬ — БАЗА РЕПОЗИТОРИЯ (ksamata_funnels.db в корне).
 * Прод правит swap-tariffs-applications-prod-2026-08-13.cjs — это разные базы,
 * и он уже отработал; здесь та же правка, чтобы базы не разъехались.
 *
 * ЧТО ЧИНИМ. Содержимое блоков «Страницы тарифов» и «Оформление заявки»
 * переставлено местами: в тарифах лежат страницы GetCourse
 * (`gc.ksamata.ru/<продукт>/tarif/<тариф>`, заголовок «Оформления заявки
 * (С куратором)»), а в заявках — страницы Tilda (`t.ksamata.ru/<продукт>/
 * tarif-<...>`, заголовок «…Тарифы 1.0»). Правило владельца: тарифы — на t.,
 * оформление заявки — на gc.
 *
 * РЕШЕНИЕ ПО ХОСТУ, А НЕ ПО СПИСКУ КОДОВ — ровно как в продовом близнеце:
 * меняются те воронки, где тарифы состоят только из gc-ссылок, а заявки —
 * только из t-ссылок (пустая сторона подходит). Смешанный случай пропускается,
 * так сама собой отсеивается f26 (в обоих блоках t-ссылки на разные продукты,
 * dbo против spb) — её судьбу решает владелец отдельно.
 *
 * Блок меняется целиком (позиции, режим, галка включения): у f8 и f93 режимы
 * у пары разные, и оставить их на месте значило бы разложить ссылки не по тем
 * колонкам. Идемпотентен: после обмена условие больше не выполняется.
 *
 * Правка идёт через replaceBlock, а не SQL, и каждая ссылка прогоняется через
 * checkUrlField — PUT-роут проверяет их сам, и скрипт не должен записать то,
 * что админка потом откажется сохранять (см. CLAUDE.md, правило про
 * fill-dashboards-2026-08-12).
 *
 * Запуск из app/ (сначала --dry-run, он только читает):
 *   npx tsx scripts/archive/swap-tariffs-applications-2026-08-13.ts --dry-run
 *   npx tsx scripts/archive/swap-tariffs-applications-2026-08-13.ts --apply
 */
import { db } from '../../src/db/client';
import { listFunnels } from '../../src/lib/funnels';
import { getBlock, replaceBlock, type BlockState } from '../../src/lib/funnel-blocks';
import { checkUrlField } from '../../src/lib/url-field';
import { funnelRefLabel } from '../../src/lib/front-code';

const TARIFF_HOST = 't.ksamata.ru';       // Tilda — страница с тарифами
const APPLICATION_HOST = 'gc.ksamata.ru'; // GetCourse — форма оформления заявки

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/** Все позиции блока лежат на этом хосте (пустой блок подходит любому). */
function onlyHost(block: BlockState, host: string): boolean {
  return block.items.every((i) => hostOf(i.url) === host);
}

function describe(block: BlockState): string {
  const hosts = [...new Set(block.items.map((i) => hostOf(i.url) ?? '(не ссылка)'))];
  return `${block.items.length} поз. [${hosts.join(',') || '—'}] ${block.mode}${block.enabled ? '' : ' выкл'}`;
}

let swapped = 0;
let skipped = 0;
let problems = 0;

for (const f of listFunnels(db)) {
  const label = funnelRefLabel({ frontCode: f.frontCode, id: f.id });
  const tariffs = getBlock(db, f.id, 'tariffs');
  const applications = getBlock(db, f.id, 'applications');

  if (tariffs.items.length === 0 && applications.items.length === 0) continue;

  const inverted = onlyHost(tariffs, APPLICATION_HOST) && onlyHost(applications, TARIFF_HOST);
  if (!inverted) {
    const alreadyRight = onlyHost(tariffs, TARIFF_HOST) && onlyHost(applications, APPLICATION_HOST);
    console.log(
      `  ${alreadyRight ? '=' : '!'} ${label}: ${alreadyRight ? 'уже по правилу' : 'смешанный случай, пропускаю'}` +
      `\n      тарифы: ${describe(tariffs)}\n      заявки: ${describe(applications)}`
    );
    skipped++;
    continue;
  }

  const bad = [...tariffs.items, ...applications.items]
    .map((i) => ({ url: i.url, check: checkUrlField(i.url) }))
    .filter((x) => x.check.level === 'error');
  if (bad.length > 0) {
    for (const b of bad) console.error(`  ! ${label}: ссылка не пройдёт проверку роута — ${b.check.message}: ${b.url}`);
    problems++;
    continue;
  }

  if (dryRun) {
    console.log(`  - ${label}: тарифы ← ${describe(applications)} | заявки ← ${describe(tariffs)}`);
    swapped++;
    continue;
  }

  replaceBlock(db, f.id, 'tariffs', applications.enabled, applications.mode, applications.items);
  replaceBlock(db, f.id, 'applications', tariffs.enabled, tariffs.mode, tariffs.items);
  console.log(`  - ${label}: обмен выполнен`);
  swapped++;
}

console.log(`\nИтого: ${swapped} ${dryRun ? 'к обмену' : 'обменов'}, ${skipped} пропущено, ${problems} проблем.`);
process.exit(problems > 0 ? 1 : 0);
