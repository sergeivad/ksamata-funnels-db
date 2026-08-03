/**
 * One-off (2026-08-04): перенос десяти вебинарных комнат воронки `f84`
 * из LeakEngine в базу. Локально; прод — отдельным решением владельца.
 *
 * Основание. На 2026-08-02 `f84` в ЛИК была «копией для брони номера»:
 * её правила побайтово повторяли `f50`. К 2026-08-04 владелец её настроил —
 * свои оси (ДБО / ИНХАУЗ / ВК / Реклама), своё предложение регистрации
 * («Регистрация на ДБО [ИНХАУС ВК ]») и свой ряд комнат `dbo*-kvch`.
 * Разбор — docs/plans/2026-08-04-leak-tag-filter-audit.md.
 *
 * Про десятую комнату. В снимке ЛИК от 2026-08-04 комнат было девять:
 * в ряду 19:00 отсутствовала `dbo4-19-kvch` при полном ряде 15:00. Все десять
 * кодов проверены запросом к `web.ksamatacenter.com/room/<код>` — живые,
 * заголовки «N-й день онлайн-курса "ДВИЖЕНИЕ БЕЗ БОЛИ И ОГРАНИЧЕНИЙ"» по дням
 * без пропусков; страницы GetCourse `gc.ksamata.ru/<код>` все отвечают 200.
 * Контроль: несуществующий `dbo9-19-kvch` отдаёт «Веб-комната не найдена»
 * (2 388 байт против 27 104 у живых), то есть проверка различает живое и
 * мёртвое. Владелец дописал `dbo4-19-kvch` в ЛИК — сверено, там снова десять.
 *
 * Столкновений нет: ряд `dbo*-kvch` в базе не занимает ни одна воронка.
 * Суффикс `kvch` (ИНХАУС ВК) живой у других продуктов — `boo*-kvch` у `f28`
 * и архивной `f16`, `dih*-kvch` у `f52`, `sst*-kvch` у `f53`.
 *
 * Правила:
 *   - Только через логику приложения: `listDays`/`replaceDays` из
 *     `../src/lib/funnel-days.ts`. Сырого SQL по `funnel_days` нет.
 *   - Проверка тождества до записи: `front_code`, `num` и все четыре оси.
 *     Несовпадение любого — отказ без записи.
 *   - Идемпотентно: если дни уже есть, скрипт не трогает ничего. `replaceDays`
 *     это ПОЛНАЯ замена внутри воронки, а не слияние, поэтому повторный прогон
 *     по непустой сетке затёр бы чужую правку.
 *   - `--dry-run` печатает намерение и не пишет.
 *
 * Запуск из app/:
 *   npx tsx scripts/sync-leak-f84-rooms-2026-08-04.ts --dry-run
 *   npx tsx scripts/sync-leak-f84-rooms-2026-08-04.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel } from '../src/lib/funnels';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';

const GC_BASE = 'https://gc.ksamata.ru/';
const WEB_BASE = 'https://web.ksamatacenter.com/room/';

const CODE = 'f84';
const NUM = 76;
const AXES = {
  product: 'ДБО',
  contractor: 'ИНХАУЗ',
  channel: 'ВК',
  direction: 'Реклама',
} as const;

/** Коды из ЛИК. Слот и день читаются из самого кода — см. decodeRoom. */
const ROOMS = [
  'dbo1-15-kvch', 'dbo2-15-kvch', 'dbo3-15-kvch', 'dbo4-15-kvch', 'dbo5-15-kvch',
  'dbo1-19-kvch', 'dbo2-19-kvch', 'dbo3-19-kvch', 'dbo4-19-kvch', 'dbo5-19-kvch',
];

const dryRun = process.argv.includes('--dry-run');

/**
 * Слот и день из кода вида `dbo4-19-kvch`. Только явная форма `<prod><день>-<слот>-`:
 * у `f84` все десять кодов такие, и угадывать слот по позиции цифры (как это
 * делает разбор легаси-кодов вроде `1dbo-boo`) здесь не нужно и опасно.
 */
function decodeRoom(code: string): { timeSlot: '19' | '15'; dayNum: number } {
  const m = /^[a-z]+(\d)-(19|15)-/.exec(code);
  if (!m) throw new Error(`код «${code}» не в форме <продукт><день>-<слот>-<суффикс>`);
  return { timeSlot: m[2] as '19' | '15', dayNum: Number(m[1]) };
}

function buildCells(codes: string[]): DayCell[] {
  const cells = new Map<string, DayCell>();
  for (const code of codes) {
    const { timeSlot, dayNum } = decodeRoom(code);
    const key = `${timeSlot}-${dayNum}`;
    if (cells.has(key)) {
      throw new Error(`две комнаты в одну ячейку ${key}: «${cells.get(key)!.gcRoom}» и «${code}»`);
    }
    cells.set(key, {
      timeSlot,
      dayNum,
      gcRoom: `${GC_BASE}${code}`,
      webRoom: `${WEB_BASE}${code}`,
      replayUrl: '',
    });
  }
  return [...cells.values()].sort(
    (a, b) => a.timeSlot.localeCompare(b.timeSlot) || a.dayNum - b.dayNum,
  );
}

function main(): void {
  const cells = buildCells(ROOMS);
  if (cells.length !== ROOMS.length) {
    throw new Error(`собрано ${cells.length} ячеек из ${ROOMS.length} кодов`);
  }

  const row = db
    .select({ id: funnels.id, num: funnels.num, status: funnels.status })
    .from(funnels)
    .where(eq(funnels.frontCode, CODE))
    .get();

  if (!row) throw new Error(`${CODE} в базе не найдена`);
  if (row.num !== NUM) throw new Error(`${CODE}: num=${row.num}, ожидался ${NUM} — отказ`);

  const full = getFunnel(db, row.id);
  if (!full) throw new Error(`${CODE}: воронка не читается`);
  const mismatch = (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((axis) => full.axes[axis] !== AXES[axis])
    .map((axis) => `${axis}: «${full.axes[axis] || '—'}» вместо «${AXES[axis]}»`);
  if (mismatch.length) throw new Error(`${CODE}: оси не совпали (${mismatch.join('; ')}) — отказ`);

  console.log(`${CODE}: id=${row.id}, num=${row.num}, статус ${row.status}, оси сошлись.`);

  const existing = listDays(db, row.id);
  if (existing.length > 0) {
    console.log(`  = дней уже ${existing.length} — не трогаю (replaceDays затёр бы их целиком).`);
    return;
  }

  const grid = cells.map((c) => `${c.timeSlot}/д${c.dayNum}`).join(' ');
  if (dryRun) {
    console.log(`  - dry-run: записал бы ${cells.length} комнат → ${grid}`);
    for (const c of cells) console.log(`      ${c.timeSlot} д${c.dayNum}  ${c.gcRoom}`);
    return;
  }

  replaceDays(db, row.id, cells);
  const after = listDays(db, row.id);
  const flag = db
    .select({ roomsEnabled: funnels.roomsEnabled })
    .from(funnels)
    .where(eq(funnels.id, row.id))
    .get();
  console.log(`  - записано ${after.length} комнат → ${grid}`);
  console.log(`  - rooms_enabled = ${flag?.roomsEnabled}`);
}

main();
