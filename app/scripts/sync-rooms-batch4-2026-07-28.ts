/**
 * Четвёртая партия по сверке с LeakEngine (2026-07-28), по решениям владельца.
 *
 * ── 1. Комнаты `f61` (num 54, ГП / НИМБ / Сайт / СЕО) ─────────────────────────
 *
 * Владелец прислал их прямо: «для ГП сео сайта комнаты Яндекса отдали»,
 * `gp1-y` … `gp5-y` и `1gp-y` … `5gp-y`.
 *
 * Это разрешает вопрос, оставшийся с прошлого шага. Единственный блок ГП с
 * Яндексом в рабочей таблице назывался «[ГП Яндекс Реклама РСЯ] НОВЫЙ ЛЕНД», и
 * я не стал приписывать эти комнаты `f79` (ГП / Алексей / Яндекс / Реклама):
 * направление у блока РСЯ, у воронки — Реклама, сопоставление не доказывалось.
 * Правильный ответ оказался третьим: комнаты передали СЕО-воронке. `f79` ушла
 * в архив без комнат, и это верно.
 *
 * Проверено перед записью: ни одна из десяти не занята другой воронкой, все
 * десять отдают 200. Комнаты `gp*-yo` (ГП / Ютуб / Органика, num 4) — другие,
 * пересечения нет.
 *
 * ── 2. Выключить комнаты у семи черновиков линейки ЖИВО ───────────────────────
 *
 *   num  код   продукт
 *    48  f47   ЖИВО-суставы-триал / НИМБ / Яндекс / РСЯ
 *    50  f51   ЖИВО-суставы-триал / ИНХАУЗ / ВК / Реклама
 *    66  f55   ЖИВО-суставы-триал / ИНХАУЗ / Яндекс / РСЯ
 *    67  f56   ЖИВО-суставы / ИНХАУЗ / Яндекс / РСЯ
 *    68  f57   ЖИВО-ЖКТ / ИНХАУЗ / Яндекс / РСЯ
 *    69  f73   ЖИВО-суставы-триал / NR / ВК / Реклама
 *    70  f74   ЖИВО-ЖКТ / NR / ВК / Реклама
 *
 * Продолжение вчерашней правки: четыре активные воронки линейки уже выключены.
 * Все семь несут в GetCourse маркер `АВ Прямые` (у `f73`/`f74` в LeakEngine
 * воронок нет, но владелец подтвердил, что комнат у них тоже нет), и у тех
 * пяти, что есть в LEAK, список комнат там пуст. Вебинаров эти воронки не
 * проводят — пустой раздел в карточке им не нужен.
 *
 * Защита по осям и идемпотентность — как в соседних скриптах. Выключение
 * отказывается работать, если у воронки вдруг есть комнаты: спрятать их молча
 * хуже, чем не сделать ничего.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-rooms-batch4-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-rooms-batch4-2026-07-28.ts --apply
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

const F61 = {
  num: 54, code: 'f61',
  axes: { product: 'ГП', contractor: 'НИМБ', channel: 'Сайт', direction: 'СЕО' } as Axes,
  rooms: ['gp1-y', 'gp2-y', 'gp3-y', 'gp4-y', 'gp5-y',
          '1gp-y', '2gp-y', '3gp-y', '4gp-y', '5gp-y'],
};

const TURN_OFF: { num: number; code: string; axes: Axes }[] = [
  { num: 48, code: 'f47', axes: { product: 'ЖИВО-суставы-триал', contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 50, code: 'f51', axes: { product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' } },
  { num: 66, code: 'f55', axes: { product: 'ЖИВО-суставы-триал', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 67, code: 'f56', axes: { product: 'ЖИВО-суставы',       contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 68, code: 'f57', axes: { product: 'ЖИВО-ЖКТ',           contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 69, code: 'f73', axes: { product: 'ЖИВО-суставы-триал', contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' } },
  { num: 70, code: 'f74', axes: { product: 'ЖИВО-ЖКТ',           contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' } },
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

type ProdFunnel = { id: number; num: number };

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).' : `Прод: ${prodList.length} воронок.`);

  // ── 1. Комнаты f61 ─────────────────────────────────────────────────────────
  console.log(`\n## ${F61.code} — комнаты gp*-y`);
  const row = db.select({ id: funnels.id }).from(funnels).where(eq(funnels.num, F61.num)).get();
  if (!row) {
    console.error(`  ! num=${F61.num} локально не найдена`);
  } else {
    const mismatch = axesMismatch(row.id, F61.axes);
    const days = listDays(db, row.id);
    const cells = buildCells(F61.rooms);
    if (mismatch.length) console.error(`  ! оси не совпали (${mismatch.join('; ')}) — пропускаю`);
    else if (days.length > 0) console.log(`  = дней уже ${days.length} — не трогаю`);
    else {
      if (dryRun) console.log(`  - ${cells.length} комнат → `
        + cells.map((c) => `${c.timeSlot}/д${c.dayNum}`).join(' '));
      else { replaceDays(db, row.id, cells); console.log(`  - ${cells.length} комнат записано локально`); }
      const p = prodByNum.get(F61.num);
      if (!skipProd && p) {
        if (dryRun) console.log(`    - на проде (id=${p.id}): ${cells.length} комнат`);
        else {
          const res = await fetch(`${PROD}/api/funnels/${p.id}/days`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cells }),
          });
          console.log(res.ok ? `    - записано на проде (HTTP ${res.status})`
            : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
      }
    }
  }

  // ── 2. Выключить комнаты у семи черновиков ─────────────────────────────────
  console.log(`\n## Выключить комнаты у семи черновиков ЖИВО`);
  for (const t of TURN_OFF) {
    const r = db.select({ id: funnels.id, flag: funnels.roomsEnabled })
      .from(funnels).where(eq(funnels.num, t.num)).get();
    if (!r) { console.error(`  ! num=${t.num} локально не найдена`); continue; }

    const mismatch = axesMismatch(r.id, t.axes);
    if (mismatch.length) {
      console.error(`  ! num=${t.num} ${t.code} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const days = listDays(db, r.id).length;
    if (days > 0) { console.error(`  ! num=${t.num} ${t.code}: комнат ${days}, выключение спрячет их — пропускаю`); continue; }

    if ((r.flag ?? 1) === 0) console.log(`  = num=${t.num} ${t.code}: уже выключено`);
    else if (dryRun) console.log(`  - num=${t.num} ${t.code}: вкл → выкл`);
    else { updateFunnel(db, r.id, { roomsEnabled: false }); console.log(`  - num=${t.num} ${t.code}: выключено локально`); }

    if (skipProd) continue;
    const p = prodByNum.get(t.num);
    if (!p) { console.error(`    ! num=${t.num} на проде не найдена`); continue; }
    if (dryRun) { console.log(`    - на проде (id=${p.id}) → выкл`); continue; }
    const res = await fetch(`${PROD}/api/funnels/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomsEnabled: false }),
    });
    console.log(res.ok ? `    - на проде выключено (HTTP ${res.status})`
      : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
