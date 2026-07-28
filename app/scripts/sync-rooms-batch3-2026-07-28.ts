/**
 * Третья партия правок по сверке с LeakEngine (2026-07-28), по решениям владельца.
 *
 * 1. `f62` (num 55, ДЫХАНИЕ / НИМБ / Сайт / СЕО) — добавить `dih5-19-sait`.
 *    В прошлой партии её сознательно пропустили: комната отдаёт 404 и стала бы
 *    вечно красной целью мониторинга. Владелец: «вноси, починим и мониторинг
 *    будет зелёный». Комната по-прежнему 404 на момент правки — это ожидаемо
 *    и временно. Сетка становится полной: 5 дней × 2 слота.
 *
 * 2. `f70` (num 63, БОО / Внутренний / Перелив / С СВС) — комнаты `boo*-yarns`.
 *    В таблице заголовок «перелив с СВС» стоял у ДВУХ блоков; владелец выбрал
 *    строку 729 «[БОО перелив с СВС] НОВАЯ ЦЕНА бывшая [БОО Яндекс Рома]».
 *    Подтверждается тегом в самой таблице (A737: «тег: БОО, перелив с СВС»).
 *    Все десять комнат живые (200).
 *
 * 3. `f79` (num 75, ГП / Алексей / Яндекс / Реклама) — в архив.
 *    Владелец: «ГП воронки все в архив, кроме ютуб органики и сео, трафика на
 *    них нет». Воронок с продуктом ГП в базе три: num 4 (Ютуб / Органика) и
 *    `f61` (Сайт / СЕО) остаются активными, под правило попадает только `f79`.
 *    Комнаты ей при этом НЕ проставляем: сопоставление с блоком
 *    «[ГП Яндекс Реклама РСЯ]» так и не доказано (у блока направление РСЯ, у
 *    воронки — Реклама), а воронке в архиве они и не нужны.
 *
 * Защита по осям и идемпотентность — как в соседних скриптах партий 1 и 2.
 * Для `f62` защита особая: комната добавляется, только если сетка сейчас ровно
 * та, что мы записали (9 ячеек) и ячейка 19/день 5 пуста. Иначе кто-то правил
 * сетку руками, и полная замена затёрла бы его работу.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-rooms-batch3-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-rooms-batch3-2026-07-28.ts --apply
 *   (--skip-prod — обкатка на копии базы)
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';
const GC_BASE = 'https://gc.ksamata.ru/';
const WEB_BASE = 'https://web.ksamatacenter.com/room/';

type Axes = { product: string; contractor: string; channel: string; direction: string };

const F62 = { num: 55, code: 'f62', add: 'dih5-19-sait', expectDays: 9,
  axes: { product: 'ДЫХАНИЕ', contractor: 'НИМБ', channel: 'Сайт', direction: 'СЕО' } as Axes };

const F70 = { num: 63, code: 'f70',
  axes: { product: 'БОО', contractor: 'Внутренний', channel: 'Перелив', direction: 'С СВС' } as Axes,
  rooms: ['boo1-yarns', 'boo2-yarns', 'boo3-yarns', 'boo4-yarns', 'boo5-yarns',
          '1boo-yarns', '2boo-yarns', '3boo-yarns', '4boo-yarns', '5boo-yarns'] };

const F79 = { num: 75, code: 'f79',
  axes: { product: 'ГП', contractor: 'Алексей', channel: 'Яндекс', direction: 'Реклама' } as Axes };

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}
const skipProd = process.argv.includes('--skip-prod');

function decodeRoom(code: string): { timeSlot: '19' | '15'; dayNum: number } {
  const explicit = /-(15|19)(?:-|$)/.exec(code);
  const digitFirst = /^(\d)/.exec(code);
  const digitAfter = /^[a-z]+(\d)/.exec(code);
  const day = digitFirst ?? digitAfter;
  if (!day) throw new Error(`не вижу номер дня в коде «${code}»`);
  const timeSlot: '19' | '15' = explicit ? (explicit[1] as '19' | '15') : (digitFirst ? '15' : '19');
  return { timeSlot, dayNum: Number(day[1]) };
}

const cellFor = (code: string): DayCell => {
  const { timeSlot, dayNum } = decodeRoom(code);
  return { timeSlot, dayNum, gcRoom: `${GC_BASE}${code}`, webRoom: `${WEB_BASE}${code}`, replayUrl: '' };
};

const sortCells = (c: DayCell[]) =>
  [...c].sort((a, b) => a.timeSlot.localeCompare(b.timeSlot) || a.dayNum - b.dayNum);

function axesMismatch(id: number, want: Axes): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((a) => full.axes[a] !== want[a])
    .map((a) => `${a}: «${full.axes[a] || '—'}» вместо «${want[a]}»`);
}

const localRow = (num: number) =>
  db.select({ id: funnels.id, status: funnels.status }).from(funnels).where(eq(funnels.num, num)).get();

type ProdFunnel = { id: number; num: number; status: string };

async function putProdDays(id: number, cells: DayCell[], label: string) {
  const res = await fetch(`${PROD}/api/funnels/${id}/days`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cells }),
  });
  console.log(res.ok ? `    - ${label}: записано на проде (HTTP ${res.status})`
    : `    ! ${label}: прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).\n' : `Прод: ${prodList.length} воронок.\n`);

  // ── 1. f62: добавить пятый день 19:00 ──────────────────────────────────────
  console.log(`## ${F62.code} — добавить ${F62.add}`);
  const r62 = localRow(F62.num);
  if (!r62) {
    console.error(`  ! num=${F62.num} локально не найдена`);
  } else {
    const mm = axesMismatch(r62.id, F62.axes);
    const days = listDays(db, r62.id);
    const has = days.some((d) => d.timeSlot === '19' && d.dayNum === 5);
    if (mm.length) console.error(`  ! оси не совпали (${mm.join('; ')}) — пропускаю`);
    else if (has) console.log('  = ячейка 19/день 5 уже занята — не трогаю');
    else if (days.length !== F62.expectDays) {
      console.error(`  ! ожидал ${F62.expectDays} дней, вижу ${days.length} — сетку правили, пропускаю`);
    } else {
      const cells = sortCells([...days, cellFor(F62.add)]);
      if (dryRun) console.log(`  - ${days.length} → ${cells.length} ячеек (+19/день 5)`);
      else { replaceDays(db, r62.id, cells); console.log(`  - добавлено локально, теперь ${cells.length} ячеек`); }
      const p = prodByNum.get(F62.num);
      if (!skipProd && p && !dryRun) await putProdDays(p.id, cells, F62.code);
      else if (!skipProd && p) console.log(`    - на проде (id=${p.id}): ${cells.length} ячеек`);
    }
  }

  // ── 2. f70: комнаты ────────────────────────────────────────────────────────
  console.log(`\n## ${F70.code} — комнаты boo*-yarns`);
  const r70 = localRow(F70.num);
  if (!r70) {
    console.error(`  ! num=${F70.num} локально не найдена`);
  } else {
    const mm = axesMismatch(r70.id, F70.axes);
    const days = listDays(db, r70.id);
    const cells = sortCells(F70.rooms.map(cellFor));
    if (mm.length) console.error(`  ! оси не совпали (${mm.join('; ')}) — пропускаю`);
    else if (days.length > 0) console.log(`  = дней уже ${days.length} — не трогаю`);
    else {
      if (dryRun) console.log(`  - ${cells.length} комнат → `
        + cells.map((c) => `${c.timeSlot}/д${c.dayNum}`).join(' '));
      else { replaceDays(db, r70.id, cells); console.log(`  - ${cells.length} комнат записано локально`); }
      const p = prodByNum.get(F70.num);
      if (!skipProd && p && !dryRun) await putProdDays(p.id, cells, F70.code);
      else if (!skipProd && p) console.log(`    - на проде (id=${p.id}): ${cells.length} комнат`);
    }
  }

  // ── 3. f79: в архив ────────────────────────────────────────────────────────
  console.log(`\n## ${F79.code} — в архив`);
  const r79 = localRow(F79.num);
  if (!r79) {
    console.error(`  ! num=${F79.num} локально не найдена`);
  } else {
    const mm = axesMismatch(r79.id, F79.axes);
    if (mm.length) console.error(`  ! оси не совпали (${mm.join('; ')}) — пропускаю`);
    else if (r79.status === 'archive') console.log('  = уже в архиве');
    else if (dryRun) console.log(`  - «${r79.status}» → «archive»`);
    else { updateFunnel(db, r79.id, { status: 'archive' }); console.log('  - в архиве локально'); }

    const p = prodByNum.get(F79.num);
    if (!skipProd && p) {
      if (p.status === 'archive') console.log('    = на проде уже в архиве');
      else if (dryRun) console.log(`    - на проде (id=${p.id}, «${p.status}») → «archive»`);
      else {
        const res = await fetch(`${PROD}/api/funnels/${p.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'archive' }),
        });
        console.log(res.ok ? `    - в архиве на проде (HTTP ${res.status})`
          : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
