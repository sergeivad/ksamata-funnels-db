/**
 * Сверка с LeakEngine, первая партия правок (2026-07-28).
 *
 * Источник: снимок LEAK `data/generated/leak-funnels-snapshot.json`, снятый
 * одним GET `https://leak.besales.ai/app-api/api/admin/funnels`.
 *
 * ДЕЛАЕТ ДВЕ ВЕЩИ.
 *
 * 1. Переименование `f77` → `f80` (num 73, СУСТАВЫ / ИНХАУЗ / Яндекс / РСЯ).
 *    Владелец завёл в LEAK черновик под номером F80 и уже передал этот номер
 *    подрядчику, поэтому источник правды здесь — LEAK. Код `f80` в базе свободен.
 *    Оси не трогаются, теги не пересчитываются.
 *
 * 2. Перенос комнат шести воронок, у которых LEAK комнаты знает, а база — нет
 *    (в базе ноль строк `funnel_days`, сетка создаётся с нуля):
 *
 *      num  код   четвёрка                                комнат
 *       41  f39   ДБО / НИМБ / Сайт / СЕО                    10
 *       42  f40   СВС / НИМБ / Сайт / СЕО                    10
 *       43  f41   ДБО / Партнер / Партнер / Партн. трафик    10
 *       51  f52   ДЫХАНИЕ / ИНХАУЗ / ВК / Реклама            10
 *       58  f53   СУСТАВЫ / ИНХАУЗ / ВК / Реклама            10
 *       65  f58   БОО / НИМБ / Ютуб / Реклама                10
 *
 * ПОЧЕМУ КОДУ КОМНАТЫ МОЖНО ВЕРИТЬ. Соглашение об именовании проверено на всех
 * 362 комнатах базы, исключений нет:
 *
 *   - явные `-15-` / `-19-` внутри кода → слот как в коде (196 из 196);
 *   - `1boo-x`, цифра впереди          → слот 15   (83 из 83);
 *   - `boo1-x`, цифра после букв       → слот 19   (83 из 83);
 *   - номер дня в коде == `day_num`    → 362 из 362.
 *
 * Адреса собираются по тому же шаблону, что и все существующие строки
 * (совпадает 362 из 362): `https://gc.ksamata.ru/<код>` и
 * `https://web.ksamatacenter.com/room/<код>`.
 *
 * Все 72 комнаты проверены живым запросом к `gc.ksamata.ru`: 200 и настоящий
 * заголовок курса. Контроль сработал — несуществующие пути отдают 404, включая
 * `dbo9-s` (девятого дня не бывает). `web.ksamatacenter.com` таким контролем не
 * проверяется: это SPA, она отдаёт 200 на любой путь.
 *
 * `f42` (ЖКТ-4вр) СЮДА НЕ ВХОДИТ. У неё четыре набора по три комнаты, а
 * `funnel_days` держит одну комнату на пару (слот, день) при
 * `CHECK(time_slot IN ('19','15'))`. Двенадцать комнат в шесть ячеек не влезают —
 * это упирается в схему и уходит в задачу «АВ Время больше не обязателен».
 *
 * ЗАЩИТА. Скрипт ОТКАЗЫВАЕТСЯ трогать воронку, чьи оси не совпали с ожидаемой
 * четвёркой: номера — вещь подвижная. Комнаты пишутся только в воронку, у которой
 * дней сейчас ноль; воронка с уже заполненной сеткой пропускается, а не
 * перезаписывается (`replaceDays` — полная замена, а не слияние).
 *
 * Идемпотентен: повторный прогон ничего не меняет.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-leak-rooms-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-leak-rooms-2026-07-28.ts --apply
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

/** Переименование кода. */
const RENAME = {
  num: 73,
  from: 'f77',
  to: 'f80',
  axes: { product: 'СУСТАВЫ', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' } as Axes,
};

/** Комнаты из LEAK. Порядок внутри массива не важен — слот и день берутся из кода. */
const ROOMS: { num: number; code: string; axes: Axes; rooms: string[] }[] = [
  {
    num: 41, code: 'f39',
    axes: { product: 'ДБО', contractor: 'НИМБ', channel: 'Сайт', direction: 'СЕО' },
    rooms: ['dbo1-s', 'dbo2-s', 'dbo3-s', 'dbo4-s', 'dbo5-s',
            '1dbo-s', '2dbo-s', '3dbo-s', '4dbo-s', '5dbo-s'],
  },
  {
    num: 42, code: 'f40',
    axes: { product: 'СВС', contractor: 'НИМБ', channel: 'Сайт', direction: 'СЕО' },
    rooms: ['cvc1-19-sait', 'cvc2-19-sait', 'cvc3-19-sait', 'cvc4-19-sait', 'cvc5-19-sait',
            'cvc1-15-sait', 'cvc2-15-sait', 'cvc3-15-sait', 'cvc4-15-sait', 'cvc5-15-sait'],
  },
  {
    num: 43, code: 'f41',
    axes: { product: 'ДБО', contractor: 'Партнер', channel: 'Партнер', direction: 'Партнерский трафик' },
    rooms: ['dbo1-pr', 'dbo2-pr', 'dbo3-pr', 'dbo4-pr', 'dbo5-pr',
            '1dbo-pr', '2dbo-pr', '3dbo-pr', '4dbo-pr', '5dbo-pr'],
  },
  {
    num: 51, code: 'f52',
    axes: { product: 'ДЫХАНИЕ', contractor: 'ИНХАУЗ', channel: 'ВК', direction: 'Реклама' },
    rooms: ['dih1-19-kvch', 'dih2-19-kvch', 'dih3-19-kvch', 'dih4-19-kvch', 'dih5-19-kvch',
            'dih1-15-kvch', 'dih2-15-kvch', 'dih3-15-kvch', 'dih4-15-kvch', 'dih5-15-kvch'],
  },
  {
    num: 58, code: 'f53',
    axes: { product: 'СУСТАВЫ', contractor: 'ИНХАУЗ', channel: 'ВК', direction: 'Реклама' },
    rooms: ['sst1-19-kvch', 'sst2-19-kvch', 'sst3-19-kvch', 'sst4-19-kvch', 'sst5-19-kvch',
            'sst1-15-kvch', 'sst2-15-kvch', 'sst3-15-kvch', 'sst4-15-kvch', 'sst5-15-kvch'],
  },
  {
    num: 65, code: 'f58',
    axes: { product: 'БОО', contractor: 'НИМБ', channel: 'Ютуб', direction: 'Реклама' },
    rooms: ['boo1-ytn', 'boo2-ytn', 'boo3-ytn', 'boo4-ytn', 'boo5-ytn',
            '1boo-ytn', '2boo-ytn', '3boo-ytn', '4boo-ytn', '5boo-ytn'],
  },
];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}
/** Обкатка на копии базы: писать только локально, прод не трогать вовсе. */
const skipProd = process.argv.includes('--skip-prod');

/**
 * Слот и день из кода комнаты. Разбор намеренно строгий: непонятный код должен
 * упасть, а не молча уехать в чужую ячейку.
 */
function decodeRoom(code: string): { timeSlot: '19' | '15'; dayNum: number } {
  const explicit = /-(15|19)(?:-|$)/.exec(code);
  const digitFirst = /^(\d)/.exec(code);
  const digitAfter = /^[a-z]+(\d)/.exec(code);

  const day = digitFirst ?? digitAfter;
  if (!day) throw new Error(`не вижу номер дня в коде «${code}»`);

  let timeSlot: '19' | '15';
  if (explicit) timeSlot = explicit[1] as '19' | '15';
  else if (digitFirst) timeSlot = '15';
  else timeSlot = '19';

  return { timeSlot, dayNum: Number(day[1]) };
}

function buildCells(rooms: string[]): DayCell[] {
  const cells = new Map<string, DayCell>();
  for (const code of rooms) {
    const { timeSlot, dayNum } = decodeRoom(code);
    const key = `${timeSlot}-${dayNum}`;
    if (cells.has(key)) {
      throw new Error(`две комнаты в одну ячейку ${key}: «${cells.get(key)!.gcRoom}» и «${code}»`);
    }
    cells.set(key, {
      timeSlot, dayNum,
      gcRoom: `${GC_BASE}${code}`,
      webRoom: `${WEB_BASE}${code}`,
      replayUrl: '',
    });
  }
  return [...cells.values()].sort((a, b) =>
    a.timeSlot.localeCompare(b.timeSlot) || a.dayNum - b.dayNum);
}

/** Расхождения осей с ожидаемыми. Пустой массив — воронка та самая. */
function axesMismatch(id: number, want: Axes): string[] {
  const full = getFunnel(db, id);
  if (!full) return ['воронка не читается'];
  return (['product', 'contractor', 'channel', 'direction'] as const)
    .filter((axis) => full.axes[axis] !== want[axis])
    .map((axis) => `${axis}: «${full.axes[axis] || '—'}» вместо «${want[axis]}»`);
}

type ProdFunnel = { id: number; num: number; frontCode: string | null; status: string };

async function main() {
  const prodList: ProdFunnel[] = skipProd
    ? []
    : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByNum = new Map(prodList.map((f) => [f.num, f]));
  console.log(skipProd ? 'Прод пропущен (--skip-prod).\n' : `Прод: ${prodList.length} воронок.\n`);

  // --- 1. Переименование ---------------------------------------------------
  console.log(`## ${RENAME.from} → ${RENAME.to} (num ${RENAME.num})`);
  const row = db.select({ id: funnels.id, code: funnels.frontCode })
    .from(funnels).where(eq(funnels.num, RENAME.num)).get();

  if (!row) {
    console.error(`  ! num=${RENAME.num} локально не найдена`);
  } else if (row.code === RENAME.to) {
    console.log(`  = локально уже ${RENAME.to}`);
  } else if (row.code !== RENAME.from) {
    console.error(`  ! локально код «${row.code ?? '—'}», ожидался «${RENAME.from}» — пропускаю`);
  } else {
    const taken = db.select({ num: funnels.num })
      .from(funnels).where(eq(funnels.frontCode, RENAME.to)).get();
    const mismatch = axesMismatch(row.id, RENAME.axes);
    if (taken) {
      console.error(`  ! код ${RENAME.to} уже занят воронкой num=${taken.num} — пропускаю`);
    } else if (mismatch.length) {
      console.error(`  ! оси не совпали (${mismatch.join('; ')}) — пропускаю`);
    } else if (dryRun) {
      console.log(`  - «${RENAME.from}» → «${RENAME.to}»`);
    } else {
      updateFunnel(db, row.id, { frontCode: RENAME.to });
      console.log(`  - переименована локально`);
    }
  }

  const renameProd = prodByNum.get(RENAME.num);
  if (skipProd) {
    // прод не трогаем
  } else if (!renameProd) {
    console.error(`  ! num=${RENAME.num} на проде не найдена`);
  } else if (renameProd.frontCode === RENAME.to) {
    console.log(`  = на проде уже ${RENAME.to}`);
  } else if (renameProd.frontCode !== RENAME.from) {
    console.error(`  ! на проде код «${renameProd.frontCode ?? '—'}» — пропускаю`);
  } else if (dryRun) {
    console.log(`  - на проде (id=${renameProd.id}): «${RENAME.from}» → «${RENAME.to}»`);
  } else {
    const res = await fetch(`${PROD}/api/funnels/${renameProd.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontCode: RENAME.to }),
    });
    console.log(res.ok
      ? `  - переименована на проде (HTTP ${res.status})`
      : `  ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // --- 2. Комнаты ----------------------------------------------------------
  console.log(`\n## Комнаты шести воронок`);
  let filled = 0;
  for (const target of ROOMS) {
    const cells = buildCells(target.rooms);
    const local = db.select({ id: funnels.id, code: funnels.frontCode })
      .from(funnels).where(eq(funnels.num, target.num)).get();

    if (!local) {
      console.error(`  ! num=${target.num} локально не найдена`);
      continue;
    }
    const mismatch = axesMismatch(local.id, target.axes);
    if (mismatch.length) {
      console.error(`  ! num=${target.num} оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const existing = listDays(db, local.id);
    if (existing.length > 0) {
      console.log(`  = num=${target.num} ${target.code}: дней уже ${existing.length} — не трогаю`);
    } else if (dryRun) {
      const grid = cells.map((c) => `${c.timeSlot}/д${c.dayNum}`).join(' ');
      console.log(`  - num=${target.num} ${target.code}: ${cells.length} комнат → ${grid}`);
    } else {
      replaceDays(db, local.id, cells);
      console.log(`  - num=${target.num} ${target.code}: ${cells.length} комнат записано локально`);
      filled += 1;
    }

    if (skipProd) continue;
    const onProd = prodByNum.get(target.num);
    if (!onProd) {
      console.error(`    ! num=${target.num} на проде не найдена`);
      continue;
    }
    const prodDays = await (await fetch(`${PROD}/api/funnels/${onProd.id}/days`)).json();
    if (Array.isArray(prodDays) && prodDays.length > 0) {
      console.log(`    = на проде дней уже ${prodDays.length} — не трогаю`);
      continue;
    }
    if (dryRun) {
      console.log(`    - на проде (id=${onProd.id}): ${cells.length} комнат`);
      continue;
    }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}/days`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cells }),
    });
    console.log(res.ok
      ? `    - записано на проде (HTTP ${res.status})`
      : `    ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  if (!dryRun) console.log(`\nСеток заполнено локально: ${filled}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
