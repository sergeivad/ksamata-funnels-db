/**
 * ЦЕЛЬ — БАЗА РЕПОЗИТОРИЯ (корневой `ksamata_funnels.db`). Прод не трогает —
 * для него отдельный скрипт `remove-dead-landings-prod-2026-09-14.cjs`,
 * пишущий через собственный HTTP API прода.
 *
 * ЗАЧЕМ. Два адреса из партии `add-landings-2026-09-07.ts` (выгрузка
 * LeakEngine за август 2026) не работали НИ РАЗУ: цели мониторинга заведены
 * 07.09 в 17:08:49, первая же проверка через шесть секунд дала 404, и в
 * `monitor_events` у обеих ровно одно событие `unknown → down`. Состояния
 * `up` в истории нет. Владелец подтвердил 14.09: эти лендинги давно сняты с
 * рекламы и удалены, в блоке им делать нечего.
 *
 *   f23 (ДБО Алексей Яндекс Реклама)   https://lp.ksamata.ru/rd_yhe
 *   f24 (БОО Алексей Яндекс Ретаргет)  https://lp.ksamata.ru/sz-ya
 *
 * Это НЕ откат всей партии: остальные 15 живых адресов той же выгрузки
 * отвечают `up` и остаются на месте.
 *
 * ПРАВИЛА:
 *   - Воронка ищется по F-коду (`normalizeFrontCode`); нет такого кода —
 *     сообщаем и пропускаем, скрипт не падает и не трогает остальные.
 *   - Сравнение адресов — без учёта регистра и хвостового слэша
 *     (`u.trim().replace(/\/+$/,'').toLowerCase()`), как в скрипте, который
 *     эти адреса и добавил.
 *   - Удаляются ТОЛЬКО перечисленные адреса. Остальные пункты остаются как
 *     есть и в том же порядке; `enabled` и `mode` блока не трогаются — блок
 *     ни у одной из двух воронок не пустеет (у f23 остаётся 1 пункт, у f24 —
 *     10), и решать за человека судьбу блока скрипту незачем.
 *   - Перед записью КАЖДЫЙ остающийся адрес проходит `checkUrlField`:
 *     `replaceBlock` URL не валидирует (это делает PUT-роут, см. CLAUDE.md),
 *     а PUT-роут прода на «слипшемся» адресе ответил бы 400 и не записал
 *     блок целиком. Уровень `error` на любой воронке — стоп с ненулевым
 *     кодом ДО первой записи, не записано ничего.
 *   - Воронка, у которой удалять нечего, не трогается — `replaceBlock` для
 *     неё не вызывается.
 *
 * МОНИТОРИНГ отдельного шага не требует: цель снимается штатным путём
 * списания (`syncMonitorTargets` — глушит, отвязывает от воронки, историю
 * инцидентов оставляет) на ближайшем цикле проверок. Строку
 * `monitor_targets` руками не удаляем: в ней висит история, а вернётся
 * адрес — цель оживёт сама.
 *
 * Путь к базе — `resolveCliDbPath()` (см. `scripts/cli-db-path.ts`).
 *
 * Идемпотентен: повторный `--apply` не находит адресов и ничего не пишет.
 *
 * Запуск из `app/`:
 *   npx tsx scripts/remove-dead-landings-2026-09-14.ts --dry-run
 *   npx tsx scripts/remove-dead-landings-2026-09-14.ts --apply
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema';
import { resolveCliDbPath } from './cli-db-path';
import { getBlock, replaceBlock } from '../src/lib/funnel-blocks';
import { checkUrlField } from '../src/lib/url-field';
import { normalizeFrontCode } from '../src/lib/front-code';

// F-код → адреса, которые надо убрать из блока «Лендинги» (см. шапку).
const PAYLOAD: Record<string, string[]> = {
  f23: ['https://lp.ksamata.ru/rd_yhe'],
  f24: ['https://lp.ksamata.ru/sz-ya'],
};

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

/** Сравнение адресов без учёта регистра и хвостового слэша. */
function normUrl(u: string): string {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

const dbPath = resolveCliDbPath();
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

console.log(`База: ${dbPath}`);
console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

const funnels = db
  .select({ id: schema.funnels.id, frontCode: schema.funnels.frontCode })
  .from(schema.funnels)
  .all() as { id: number; frontCode: string }[];

const byCode = new Map<string, number>();
for (const f of funnels) {
  const code = normalizeFrontCode(f.frontCode);
  if (code) byCode.set(code, f.id);
}

type Plan = { code: string; funnelId: number; keep: { slot: '15' | '19' | null; label: string; url: string }[]; removed: string[] };
const plans: Plan[] = [];
let missing = 0;
let unchanged = 0;

for (const [rawCode, urls] of Object.entries(PAYLOAD)) {
  const funnelId = byCode.get(normalizeFrontCode(rawCode));
  if (funnelId === undefined) {
    console.log(`  ? ${rawCode}: такого F-кода в базе нет — пропускаю`);
    missing++;
    continue;
  }

  const block = getBlock(db, funnelId, 'landings');
  const drop = new Set(urls.map(normUrl));
  const keep = block.items.filter((i) => !drop.has(normUrl(i.url)));
  const removed = block.items.filter((i) => drop.has(normUrl(i.url))).map((i) => i.url);

  if (removed.length === 0) {
    console.log(`  = ${rawCode}: этих адресов в блоке нет (пунктов: ${block.items.length}) — пропускаю`);
    unchanged++;
    continue;
  }

  console.log(`  ${dryRun ? '~' : '-'} ${rawCode}: было ${block.items.length}, убираем ${removed.length}, останется ${keep.length}`);
  for (const u of removed) console.log(`        ✗ ${u}`);

  plans.push({ code: rawCode, funnelId, keep, removed });
}

// Гигиена остающихся адресов — ДО первой записи, чтобы отказ не оставил
// половину воронок правленными, а половину нет.
let bad = 0;
for (const plan of plans) {
  for (const item of plan.keep) {
    const check = checkUrlField(item.url);
    if (check.level === 'error') {
      console.error(`  ! ${plan.code}: остающийся адрес не пройдёт валидацию роута: ${item.url} — ${check.message}`);
      bad++;
    } else if (check.level === 'warn') {
      console.log(`  · ${plan.code}: предупреждение по остающемуся адресу: ${item.url} — ${check.message}`);
    }
  }
}
if (bad > 0) {
  console.error(`\nОстановлено: ${bad} адресов уровня error. Ничего не записано.`);
  process.exit(1);
}

if (!dryRun) {
  for (const plan of plans) {
    const block = getBlock(db, plan.funnelId, 'landings');
    replaceBlock(db, plan.funnelId, 'landings', block.enabled, block.mode, plan.keep);
  }
}

console.log(
  `\nИтого: ${plans.length} ${dryRun ? 'к правке' : 'записано'}, ${unchanged} без изменений, ` +
    `${missing} без такого F-кода в базе.`
);
sqlite.close();
