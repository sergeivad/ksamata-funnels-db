/**
 * Комнаты пяти СЕО-воронок из рабочей таблицы владельца (2026-07-28).
 *
 * Источник: `Воронки ссылки.xlsx`, только ВИДИМЫЕ вкладки (четыре скрытых —
 * «Жизнь для Марины», «Детокс переупаковка», «Жизнь для Сергея », «РД для
 * Сергея», «(для Сергея) ЧО» — не читались по указанию владельца).
 *
 *   num  код   четвёрка                      блок в таблице            комнат
 *    52  f59   ЕХ / НИМБ / Сайт / СЕО        ЕХ, [ЕХ Сайт]                 10
 *    53  f60   ЩЖ / НИМБ / Сайт / СЕО        ЩЖ, [ЩЖ Сайт]                  6
 *    55  f62   ДЫХАНИЕ / НИМБ / Сайт / СЕО   ДЫХАНИЕ, [ДЫХАНИЕ Сайт]        9
 *    56  f63   СУСТАВЫ / НИМБ / Сайт / СЕО   СУСТАВЫ, [СУСТАВЫ Сайт]       10
 *    62  f69   БОО / НИМБ / Сайт / СЕО       БОО, [БОО сайт] НОВАЯ ЦЕНА    10
 *
 * ПОЧЕМУ У f62 ДЕВЯТЬ, А НЕ ДЕСЯТЬ. В таблице блок полный — пять дней на оба
 * времени. Но `dih5-19-sait` отдаёт **404**, остальные девять — 200. Мёртвую
 * комнату не вносим намеренно: она стала бы вечно красной целью мониторинга
 * (тот же случай, что описан в CLAUDE.md про ghost target). День 5 в 19:00
 * остаётся без комнаты, пока её не создадут в GetCourse.
 *
 * У f59 продукт ЕХ пишется префиксом `wl`, а не `ex` — так в таблице и в
 * GetCourse.
 *
 * f69 берёт блок «НОВАЯ ЦЕНА» (`boo*-sns`), а не старый `[БОО сайт]`
 * (`boo*-s`): у старого в колонке А стоит пометка «отключена».
 *
 * НЕ ВОШЛИ, и почему:
 *   f64, f74 — предложенные было блоки `[ДБО ВК NR МП]` и `[ЖИВО ВК NR]`
 *              принадлежат ДРУГИМ воронкам: их коды уже стоят у num15/f15
 *              (Маркетплатформа — это и есть «МП») и num36/f27 (ЖИВО, не
 *              ЖИВО-ЖКТ). Своих блоков у f64 и f74 в таблице нет.
 *   f78     — блок `[ТКМ ВК NR]` в таблице есть, но все десять комнат отдают
 *              404: воронка черновик, комнаты в GetCourse ещё не созданы.
 *   f70     — «перелив с СВС» стоит у ДВУХ блоков (`boo*-yarns` и `boo*-zm`),
 *              какой из них настоящий — вопрос к владельцу.
 *   f79     — единственный Яндекс-блок ГП размечен как РСЯ, а у воронки
 *              направление «Реклама». Сопоставление не доказано.
 *   f61, f66, f67, f68, f73 — блоков в таблице нет вовсе.
 *
 * Раскладка кодов в сетку — по тому же соглашению, что и в
 * sync-leak-rooms-2026-07-28.ts (проверено на всех комнатах базы).
 * Все вносимые комнаты проверены запросом: 200 и настоящая страница вебинара.
 *
 * Защита и идемпотентность — как в соседнем скрипте: воронка с несовпавшими
 * осями пропускается, воронка с уже заполненной сеткой не перезаписывается.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-sheet-rooms-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-sheet-rooms-2026-07-28.ts --apply
 *   (--skip-prod — обкатка на копии базы, прод не трогать)
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel } from '../src/lib/funnels';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';
const GC_BASE = 'https://gc.ksamata.ru/';
const WEB_BASE = 'https://web.ksamatacenter.com/room/';

type Axes = { product: string; contractor: string; channel: string; direction: string };
const SEO = (product: string): Axes =>
  ({ product, contractor: 'НИМБ', channel: 'Сайт', direction: 'СЕО' });

const TARGETS: { num: number; code: string; axes: Axes; rooms: string[] }[] = [
  {
    num: 52, code: 'f59', axes: SEO('ЕХ'),
    rooms: ['wl1-19-sait', 'wl2-19-sait', 'wl3-19-sait', 'wl4-19-sait', 'wl5-19-sait',
            'wl1-15-sait', 'wl2-15-sait', 'wl3-15-sait', 'wl4-15-sait', 'wl5-15-sait'],
  },
  {
    num: 53, code: 'f60', axes: SEO('ЩЖ'),
    rooms: ['shzh1-19-sait', 'shzh2-19-sait', 'shzh3-19-sait',
            'shzh1-15-sait', 'shzh2-15-sait', 'shzh3-15-sait'],
  },
  {
    // dih5-19-sait исключена сознательно — 404, см. шапку.
    num: 55, code: 'f62', axes: SEO('ДЫХАНИЕ'),
    rooms: ['dih1-19-sait', 'dih2-19-sait', 'dih3-19-sait', 'dih4-19-sait',
            'dih1-15-sait', 'dih2-15-sait', 'dih3-15-sait', 'dih4-15-sait', 'dih5-15-sait'],
  },
  {
    num: 56, code: 'f63', axes: SEO('СУСТАВЫ'),
    rooms: ['sst1-19-sait', 'sst2-19-sait', 'sst3-19-sait', 'sst4-19-sait', 'sst5-19-sait',
            'sst1-15-sait', 'sst2-15-sait', 'sst3-15-sait', 'sst4-15-sait', 'sst5-15-sait'],
  },
  {
    num: 62, code: 'f69', axes: SEO('БОО'),
    rooms: ['boo1-sns', 'boo2-sns', 'boo3-sns', 'boo4-sns', 'boo5-sns',
            '1boo-sns', '2boo-sns', '3boo-sns', '4boo-sns', '5boo-sns'],
  },
];

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

function buildCells(rooms: string[]): DayCell[] {
  const cells = new Map<string, DayCell>();
  for (const code of rooms) {
    const { timeSlot, dayNum } = decodeRoom(code);
    const key = `${timeSlot}-${dayNum}`;
    if (cells.has(key)) throw new Error(`две комнаты в ячейку ${key}: «${cells.get(key)!.gcRoom}» и «${code}»`);
    cells.set(key, { timeSlot, dayNum, gcRoom: `${GC_BASE}${code}`, webRoom: `${WEB_BASE}${code}`, replayUrl: '' });
  }
  return [...cells.values()].sort((a, b) =>
    a.timeSlot.localeCompare(b.timeSlot) || a.dayNum - b.dayNum);
}

function axesMismatch(id: number, want: Axes): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((a) => full.axes[a] !== want[a])
    .map((a) => `${a}: «${full.axes[a] || '—'}» вместо «${want[a]}»`);
}

type ProdFunnel = { id: number; num: number; frontCode: string | null };

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).\n' : `Прод: ${prodList.length} воронок.\n`);

  let filled = 0;
  for (const t of TARGETS) {
    const cells = buildCells(t.rooms);
    const local = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, t.num)).get();
    if (!local) { console.error(`  ! num=${t.num} локально не найдена`); continue; }

    const mismatch = axesMismatch(local.id, t.axes);
    if (mismatch.length) {
      console.error(`  ! num=${t.num} ${t.code} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const existing = listDays(db, local.id);
    if (existing.length > 0) {
      console.log(`  = num=${t.num} ${t.code}: дней уже ${existing.length} — не трогаю`);
    } else if (dryRun) {
      console.log(`  - num=${t.num} ${t.code}: ${cells.length} комнат → `
        + cells.map((c) => `${c.timeSlot}/д${c.dayNum}`).join(' '));
    } else {
      replaceDays(db, local.id, cells);
      console.log(`  - num=${t.num} ${t.code}: ${cells.length} комнат записано локально`);
      filled += 1;
    }

    if (skipProd) continue;
    const onProd = prodByNum.get(t.num);
    if (!onProd) { console.error(`    ! num=${t.num} на проде не найдена`); continue; }
    const prodDays = await (await fetch(`${PROD}/api/funnels/${onProd.id}/days`)).json();
    if (Array.isArray(prodDays) && prodDays.length > 0) {
      console.log(`    = на проде дней уже ${prodDays.length} — не трогаю`);
      continue;
    }
    if (dryRun) { console.log(`    - на проде (id=${onProd.id}): ${cells.length} комнат`); continue; }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}/days`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells }),
    });
    console.log(res.ok ? `    - записано на проде (HTTP ${res.status})`
      : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  if (!dryRun) console.log(`\nСеток заполнено локально: ${filled}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
