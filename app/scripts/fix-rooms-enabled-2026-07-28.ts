/**
 * Флаг «у воронки есть вебинарные комнаты» разошёлся с фактом. Правка
 * 2026-07-28 по решению владельца.
 *
 * ЧТО ЭТО ЗА ФЛАГ. `funnels.rooms_enabled` — переключатель раздела «Комнаты»
 * в карточке воронки. Выключение НЕ удаляет строки `funnel_days`, оно прячет
 * их: карточка не показывает раздел, компактный вид не показывает комнаты, и —
 * что важнее всего — `buildExportRows` пропускает комнаты выключенной воронки
 * (export.ts: `detail.roomsEnabled ? listDays(...) : []`).
 *
 * КАК РАЗОШЁЛСЯ. Флаг ставит ровно два места: разовый бэкфилл Phase-4 и
 * `RoomsEditor` в админке (он после PUT дней отдельным PATCH сохраняет флаг).
 * Все остальные писатели `funnel_days` — четыре питон-скрипта импорта и
 * несколько разовых tsx — флага не касаются вовсе. Поэтому:
 *
 *   1. `seed-phase1.ts` завёл num 33–38 «скелетами»: удостоверение и АВ-теги,
 *      без `funnel_days` (так и написано в его шапке);
 *   2. бэкфилл Phase-4 выставил `rooms_enabled = 0` всем, у кого дней нет —
 *      поймал ровно эти шесть;
 *   3. комнаты им заполнили позже, а флаг вернуть было некому.
 *
 * ЦЕНА. 52 комнаты из 478 (10%) не видны в админке и не попадают в экспорт —
 * это 104 строки выгрузки. У четырёх из шести воронок статус `active`.
 * Замер: в экспорте 426 строк «Комнаты (GC)» вместо 478, и ноль строк по этим
 * шести. Мониторинга это не касается — он собирает только блоки и посадочные,
 * комнаты в него не входят вовсе.
 *
 * ── ЧАСТЬ 1: включить показ (комнаты есть, флаг выключен) ─────────────────────
 *
 *   num  код   статус    комнат
 *    33  f32   active     10     СУСТАВЫ / НИМБ / Яндекс / РСЯ
 *    34  f33   archive     6     ЖИВО / НИМБ / Яндекс / РСЯ
 *    35  f34   draft      10     ТКМ / НИМБ / Яндекс / РСЯ
 *    36  f27   active      6     ЖИВО / NR / ВК / Реклама
 *    37  f29   active     10     СВС / НИМБ / ВК / Реклама
 *    38  f30   active     10     ДЫХАНИЕ / FAQ / ВК / Реклама
 *
 * Комнаты у всех шести живые (200) и совпадают с набором в LeakEngine
 * дословно — то есть прятать там нечего.
 *
 * ── ЧАСТЬ 2: выключить показ (вебинаров нет по существу) ──────────────────────
 *
 *   num  код   статус   ЖИВО-линейка
 *    46  f45   active   ЖИВО-суставы / НИМБ / Яндекс / РСЯ
 *    47  f46   active   ЖИВО-суставы / ИНХАУЗ / ВК / Реклама
 *    49  f48   active   ЖИВО-ЖКТ / ИНХАУЗ / ВК / Реклама
 *    64  f54   active   ЖИВО-ЖКТ / НИМБ / Яндекс / РСЯ
 *
 * Это не пробел в данных. Все четыре несут в GetCourse маркер `АВ Прямые`, а
 * не `АВ Автоворонка`, и в LeakEngine у них тоже пустой список комнат — в
 * отличие от ЖИВО-автоворонок `f33` и `f27`, у которых комнаты есть в обеих
 * системах. Владелец подтвердил: комнат быть не должно.
 *
 * Выключение здесь возвращает флагу его смысл — «вебинаров у воронки нет» —
 * и убирает пустой раздел из карточки. Строк `funnel_days` у них и так ноль,
 * так что терять нечего.
 *
 * Тем же маркером `АВ Прямые` помечены ещё семь воронок линейки (`f47`, `f51`,
 * `f55`, `f56`, `f57`, `f73`, `f74`) — все в статусе `draft`. Их владелец
 * отдельно не называл, поэтому в эту правку они НЕ входят.
 *
 * Защита по осям и идемпотентность — как в соседних скриптах.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/fix-rooms-enabled-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/fix-rooms-enabled-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { getFunnel, updateFunnel } from '../src/lib/funnels';
import { listDays } from '../src/lib/funnel-days';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

type Axes = { product: string; contractor: string; channel: string; direction: string };
type Target = { num: number; code: string; axes: Axes; want: boolean };

const TURN_ON: Target[] = [
  { num: 33, code: 'f32', want: true, axes: { product: 'СУСТАВЫ', contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 34, code: 'f33', want: true, axes: { product: 'ЖИВО',    contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 35, code: 'f34', want: true, axes: { product: 'ТКМ',     contractor: 'НИМБ', channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 36, code: 'f27', want: true, axes: { product: 'ЖИВО',    contractor: 'NR',   channel: 'ВК',     direction: 'Реклама' } },
  { num: 37, code: 'f29', want: true, axes: { product: 'СВС',     contractor: 'НИМБ', channel: 'ВК',     direction: 'Реклама' } },
  { num: 38, code: 'f30', want: true, axes: { product: 'ДЫХАНИЕ', contractor: 'FAQ',  channel: 'ВК',     direction: 'Реклама' } },
];

const TURN_OFF: Target[] = [
  { num: 46, code: 'f45', want: false, axes: { product: 'ЖИВО-суставы', contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' } },
  { num: 47, code: 'f46', want: false, axes: { product: 'ЖИВО-суставы', contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' } },
  { num: 49, code: 'f48', want: false, axes: { product: 'ЖИВО-ЖКТ',     contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' } },
  { num: 64, code: 'f54', want: false, axes: { product: 'ЖИВО-ЖКТ',     contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' } },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}
const skipProd = process.argv.includes('--skip-prod');

function axesMismatch(id: number, want: Axes): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((a) => full.axes[a] !== want[a])
    .map((a) => `${a}: «${full.axes[a] || '—'}» вместо «${want[a]}»`);
}

type ProdFunnel = { id: number; num: number; roomsEnabled: boolean };

async function run(targets: Target[], prodByNum: Map<number, ProdFunnel>, title: string) {
  console.log(`\n## ${title}`);
  for (const t of targets) {
    const row = db.select({ id: funnels.id, flag: funnels.roomsEnabled })
      .from(funnels).where(eq(funnels.num, t.num)).get();
    if (!row) { console.error(`  ! num=${t.num} локально не найдена`); continue; }

    const mismatch = axesMismatch(row.id, t.axes);
    if (mismatch.length) {
      console.error(`  ! num=${t.num} ${t.code} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const days = listDays(db, row.id).length;
    // Страховка от опечатки в списках: включать нечего без комнат, выключать
    // нельзя то, где комнаты есть.
    if (t.want && days === 0) { console.error(`  ! num=${t.num} ${t.code}: комнат ноль, включать нечего — пропускаю`); continue; }
    if (!t.want && days > 0)  { console.error(`  ! num=${t.num} ${t.code}: комнат ${days}, выключение спрячет их — пропускаю`); continue; }

    const now = (row.flag ?? 1) === 1;
    if (now === t.want) console.log(`  = num=${t.num} ${t.code}: уже ${t.want ? 'включено' : 'выключено'}`);
    else if (dryRun) console.log(`  - num=${t.num} ${t.code}: ${now ? 'вкл' : 'выкл'} → ${t.want ? 'вкл' : 'выкл'} (комнат ${days})`);
    else { updateFunnel(db, row.id, { roomsEnabled: t.want }); console.log(`  - num=${t.num} ${t.code}: ${t.want ? 'включено' : 'выключено'} локально (комнат ${days})`); }

    if (skipProd) continue;
    const onProd = prodByNum.get(t.num);
    if (!onProd) { console.error(`    ! num=${t.num} на проде не найдена`); continue; }
    if (onProd.roomsEnabled === t.want) { console.log(`    = на проде уже ${t.want ? 'включено' : 'выключено'}`); continue; }
    if (dryRun) { console.log(`    - на проде (id=${onProd.id}) → ${t.want ? 'вкл' : 'выкл'}`); continue; }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomsEnabled: t.want }),
    });
    console.log(res.ok ? `    - на проде ${t.want ? 'включено' : 'выключено'} (HTTP ${res.status})`
      : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function main() {
  const prodList: ProdFunnel[] = skipProd ? [] : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).' : `Прод: ${prodList.length} воронок.`);
  await run(TURN_ON, prodByNum, 'Включить показ комнат');
  await run(TURN_OFF, prodByNum, 'Выключить показ комнат (вебинаров нет)');
}

main().catch((err) => { console.error(err); process.exit(1); });
