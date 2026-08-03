/**
 * Сверка с LeakEngine, вторая партия правок (2026-08-02).
 *
 * Источник: реестр ЛИК на 2026-08-02 (57 воронок), читается одним GET
 * `https://leak.besales.ai/app-api/api/admin/funnels` — см. docs/leak-engine.md.
 * Копия снимка на диск не кладётся: реестр снимается заново одной командой.
 * Разбор и решения владельца — docs/plans/2026-08-02-leak-sync.md.
 *
 * ДЕЛАЕТ ТРИ ВЕЩИ.
 *
 * 1. Комнаты двух воронок, у которых в базе ноль строк `funnel_days`:
 *
 *    - `f80` — в ЛИК воронка перестала быть копией `f32`: у неё свои десять
 *      комнат `sst*-inya` (ИНХАУС Яндекс), своё предложение регистрации
 *      «Регистрация на суставы [ИНХАУС ЯНДЕКС ]» и оси ИНХАУЗ.
 *    - `f78` — десять комнат `tkm*-nr`, по решению владельца (см. оговорку
 *      про источник рядом с самими кодами ниже).
 *
 * 2. `f84` — новая воронка. В ЛИК заведена 2026-08-02 черновиком
 *    «ДБО / ИНХАУЗ / ВК / Реклама». Комнат ей НЕ ставим: правила ЛИК побайтово
 *    повторяют `f50` (комнаты `dbo*-ytn`, регистрация «Регистрация на ДБО
 *    (ЮТУБ НИМБ)») — это известная идиома владельца «скопировал, чтоб забить
 *    номер», настоящих настроек у воронки ещё нет.
 *
 * 3. Активация одиннадцати черновиков. Восемь подтверждены ЛИК (там они
 *    ACTIVE), три (`f73`, `f74`, `f78`) — прямым решением владельца
 *    2026-08-02, их ещё предстоит завести в ЛИК.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ.
 *
 * - `f83`: имя воронки в ЛИК («… / Со всех») расходится с её же правилами
 *   («АВ Направление: С БОО»). Владелец подтвердил, что верно «С БОО» —
 *   база и правила ЛИК уже согласованы, чинить надо имя в ЛИК. Базу не трогаем.
 * - Статусы `archive` против ЛИК `ACTIVE` (`f6`, `f12`, `f13`, `f19`, `f33`,
 *   `f43`, `f58`): база главнее, выключать надо в ЛИК.
 * - `f25` / `f26` и колонка `room_id_f1`: см. отдельную заметку в плане —
 *   колонку не читает ни один потребитель, и `replaceDays` её обнуляет.
 * - `f42` (ЖКТ-4вр): четыре набора по три комнаты против двух слотов схемы.
 *   Как и 28.07, заблокирована и уходит в задачу «АВ Время больше не обязателен».
 *
 * ПОЧЕМУ КОДАМ КОМНАТ МОЖНО ВЕРИТЬ. Соглашение об именовании то же, что
 * проверялось 28.07 на всех комнатах базы: явные `-15-`/`-19-` внутри кода →
 * слот как в коде; `1boo-x` (цифра впереди) → 15; `boo1-x` (цифра после букв)
 * → 19; номер дня в коде == `day_num`.
 *
 * Все двадцать комнат проверены живым запросом. Проверять надо
 * `web.ksamatacenter.com/room/<код>` — это САМА комната; `gc.ksamata.ru/<код>` —
 * лишь страница GetCourse, и её отсутствие о комнате не говорит ничего (ровно
 * на этом первый прогон сверки ошибочно объявил комнаты `f25` несуществующими).
 * Оба хоста отдают осмысленный ответ на несуществующий код: `gc` — 404,
 * `web` — 200 с заголовком «Веб-комната не найдена».
 *
 * ЗАЩИТА. Скрипт ОТКАЗЫВАЕТСЯ трогать воронку, чьи оси не совпали с ожидаемой
 * четвёркой: номера — вещь подвижная. Комнаты пишутся только в воронку, у
 * которой дней сейчас ноль (`replaceDays` — полная замена, а не слияние).
 * Активация — только из `draft`; воронку в другом статусе скрипт пропускает,
 * а не переводит.
 *
 * Идемпотентен: повторный прогон ничего не меняет.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-leak-2026-08-02.ts --dry-run --skip-prod
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/sync-leak-2026-08-02.ts --apply --skip-prod
 *
 * Прод отдельным проходом, с учёткой редактора в окружении:
 *   ADMIN_BASIC_AUTH='имя:пароль' npx tsx scripts/sync-leak-2026-08-02.ts --apply
 *
 * Без `ADMIN_BASIC_AUTH` прод-запись вернёт 401, и скрипт это напечатает.
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { createFunnel, getFunnel, updateFunnel } from '../src/lib/funnels';
import { listDays, replaceDays, type DayCell } from '../src/lib/funnel-days';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

/**
 * Учётка редактора для прода. Чтение на проде публично, любая запись — 401
 * (см. раздел Auth в CLAUDE.md), поэтому без неё имеет смысл только
 * `--skip-prod`. Формат `имя:пароль`, та же переменная, что у сервиса.
 * Пароль живёт в окружении и в репозиторий не попадает.
 */
const PROD_AUTH = process.env.ADMIN_BASIC_AUTH ?? '';

function prodHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PROD_AUTH) h.Authorization = `Basic ${Buffer.from(PROD_AUTH).toString('base64')}`;
  return h;
}

const GC_BASE = 'https://gc.ksamata.ru/';
const WEB_BASE = 'https://web.ksamatacenter.com/room/';

type Axes = { product: string; contractor: string; channel: string; direction: string };

/** 1. Комнаты из ЛИК. Порядок не важен — слот и день берутся из кода. */
const ROOMS: { num: number; code: string; axes: Axes; rooms: string[] }[] = [
  {
    num: 73, code: 'f80',
    axes: { product: 'СУСТАВЫ', contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },
    rooms: ['sst1-15-inya', 'sst2-15-inya', 'sst3-15-inya', 'sst4-15-inya', 'sst5-15-inya',
            'sst1-19-inya', 'sst2-19-inya', 'sst3-19-inya', 'sst4-19-inya', 'sst5-19-inya'],
  },
  {
    // Добавлено вторым заходом того же дня. Оговорка про источник: коды найдены
    // перебором и проверены живыми страницами (`1й`…`5й день онлайн-курса
    // «КОД МОЛОДОСТИ ПОСЛЕ 50»`), а в ЛИК их записали мы же, заводя `f78`
    // 2026-08-02, — то есть ЛИК тут не независимый свидетель. Перенос сделан
    // по прямому решению владельца.
    num: 74, code: 'f78',
    axes: { product: 'ТКМ', contractor: 'NR', channel: 'ВК', direction: 'Реклама' },
    rooms: ['tkm1-15-nr', 'tkm2-15-nr', 'tkm3-15-nr', 'tkm4-15-nr', 'tkm5-15-nr',
            'tkm1-19-nr', 'tkm2-19-nr', 'tkm3-19-nr', 'tkm4-19-nr', 'tkm5-19-nr'],
  },
];

/**
 * 2. Новая воронка `f84`. `num` не выводится из кода: это независимые
 * нумерации (см. front-code.ts). Берём следующий свободный num.
 */
const NEW_FUNNEL = {
  frontCode: 'f84',
  axes: { product: 'ДБО', contractor: 'ИНХАУЗ', channel: 'ВК', direction: 'Реклама' } as Axes,
  funnelType: 'АВ Автоворонка',
  status: 'draft' as const,
};

/** 3. Черновики к активации. `confirmedByLeak` — есть ли подтверждение из ЛИК. */
const ACTIVATE: { code: string; axes: Axes; confirmedByLeak: boolean }[] = [
  { code: 'f34', axes: { product: 'ТКМ',                 contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },     confirmedByLeak: true },
  { code: 'f47', axes: { product: 'ЖИВО-суставы-триал',  contractor: 'НИМБ',   channel: 'Яндекс', direction: 'РСЯ' },     confirmedByLeak: true },
  { code: 'f51', axes: { product: 'ЖИВО-суставы-триал',  contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' }, confirmedByLeak: true },
  { code: 'f52', axes: { product: 'ДЫХАНИЕ',             contractor: 'ИНХАУЗ', channel: 'ВК',     direction: 'Реклама' }, confirmedByLeak: true },
  { code: 'f55', axes: { product: 'ЖИВО-суставы-триал',  contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },     confirmedByLeak: true },
  { code: 'f56', axes: { product: 'ЖИВО-суставы',        contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },     confirmedByLeak: true },
  { code: 'f57', axes: { product: 'ЖИВО-ЖКТ',            contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },     confirmedByLeak: true },
  { code: 'f80', axes: { product: 'СУСТАВЫ',             contractor: 'ИНХАУЗ', channel: 'Яндекс', direction: 'РСЯ' },     confirmedByLeak: true },
  { code: 'f73', axes: { product: 'ЖИВО-суставы-триал',  contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' }, confirmedByLeak: false },
  { code: 'f74', axes: { product: 'ЖИВО-ЖКТ',            contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' }, confirmedByLeak: false },
  { code: 'f78', axes: { product: 'ТКМ',                 contractor: 'NR',     channel: 'ВК',     direction: 'Реклама' }, confirmedByLeak: false },
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

function localByCode(code: string) {
  return db
    .select({ id: funnels.id, num: funnels.num, status: funnels.status })
    .from(funnels)
    .where(eq(funnels.frontCode, code))
    .get();
}

type ProdFunnel = { id: number; num: number; frontCode: string | null; status: string };

async function main() {
  const prodList: ProdFunnel[] = skipProd
    ? []
    : await (await fetch(`${PROD}/api/funnels`)).json();
  const prodByCode = new Map(
    prodList.filter((f) => f.frontCode).map((f) => [f.frontCode as string, f]),
  );
  console.log(skipProd ? 'Прод пропущен (--skip-prod).\n' : `Прод: ${prodList.length} воронок.\n`);

  // --- 1. Комнаты f80 ------------------------------------------------------
  console.log('## Комнаты из ЛИК');
  for (const target of ROOMS) {
    const cells = buildCells(target.rooms);
    const local = localByCode(target.code);

    if (!local) {
      console.error(`  ! ${target.code} локально не найдена`);
      continue;
    }
    if (local.num !== target.num) {
      console.error(`  ! ${target.code}: num=${local.num}, ожидался ${target.num} — пропускаю`);
      continue;
    }
    const mismatch = axesMismatch(local.id, target.axes);
    if (mismatch.length) {
      console.error(`  ! ${target.code}: оси не совпали (${mismatch.join('; ')}) — пропускаю`);
      continue;
    }
    const existing = listDays(db, local.id);
    if (existing.length > 0) {
      console.log(`  = ${target.code}: дней уже ${existing.length} — не трогаю`);
    } else if (dryRun) {
      const grid = cells.map((c) => `${c.timeSlot}/д${c.dayNum}`).join(' ');
      console.log(`  - ${target.code}: ${cells.length} комнат → ${grid}`);
    } else {
      replaceDays(db, local.id, cells);
      console.log(`  - ${target.code}: ${cells.length} комнат записано локально`);
    }

    const onProd = prodByCode.get(target.code);
    if (skipProd) {
      // прод не трогаем
    } else if (!onProd) {
      console.error(`  ! ${target.code} на проде не найдена`);
    } else {
      const days = await (await fetch(`${PROD}/api/funnels/${onProd.id}/days`)).json();
      if (Array.isArray(days) && days.length > 0) {
        console.log(`  = ${target.code}: на проде дней уже ${days.length} — не трогаю`);
      } else if (dryRun) {
        console.log(`  - ${target.code}: на проде (id=${onProd.id}) ${cells.length} комнат`);
      } else {
        const res = await fetch(`${PROD}/api/funnels/${onProd.id}/days`, {
          method: 'PUT',
          headers: prodHeaders(),
          body: JSON.stringify({ cells }),
        });
        console.log(res.ok
          ? `  - ${target.code}: комнаты записаны на проде (HTTP ${res.status})`
          : `  ! ${target.code}: прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    }
  }

  // --- 2. Новая воронка f84 ------------------------------------------------
  console.log(`\n## Новая воронка ${NEW_FUNNEL.frontCode}`);
  const existingNew = localByCode(NEW_FUNNEL.frontCode);
  if (existingNew) {
    console.log(`  = ${NEW_FUNNEL.frontCode} уже есть локально (num=${existingNew.num})`);
  } else {
    const maxNum = db.select({ num: funnels.num }).from(funnels).all() as { num: number }[];
    const nextNum = Math.max(...maxNum.map((r) => r.num)) + 1;
    const payload = {
      num: nextNum,
      frontCode: NEW_FUNNEL.frontCode,
      status: NEW_FUNNEL.status,
      productName: '',
      // `variant` — легаси-подпись из экселя, не ось: у 36 воронок из 72 она
      // пуста, а значения между собой несогласованы (РСЯ, ЮТУБ, ВК,
      // «суставы-триал»). У всех воронок ИНХАУЗ/ВК она пустая — оставляем так.
      // Класть сюда направление нельзя: ось уже живёт в тегах.
      variant: '',
      landingUrl: '',
      startDate: '',
      ...NEW_FUNNEL.axes,
      funnelType: NEW_FUNNEL.funnelType,
    };
    if (dryRun) {
      console.log(`  - создать num=${nextNum} «${Object.values(NEW_FUNNEL.axes).join(' / ')}»`
        + `, тип «${NEW_FUNNEL.funnelType}», статус ${NEW_FUNNEL.status}, без комнат`);
    } else {
      const created = createFunnel(db, payload);
      console.log(`  - создана локально: id=${created.id}, num=${created.num}`);
    }
  }

  if (!skipProd) {
    if (prodByCode.has(NEW_FUNNEL.frontCode)) {
      console.log(`  = ${NEW_FUNNEL.frontCode} уже есть на проде`);
    } else if (dryRun) {
      console.log(`  - создать ${NEW_FUNNEL.frontCode} на проде`);
    } else {
      const nextNumProd = Math.max(...prodList.map((f) => f.num)) + 1;
      const res = await fetch(`${PROD}/api/funnels`, {
        method: 'POST',
        headers: prodHeaders(),
        body: JSON.stringify({
          num: nextNumProd,
          frontCode: NEW_FUNNEL.frontCode,
          status: NEW_FUNNEL.status,
          productName: '',
          variant: '',
          landingUrl: '',
          startDate: '',
          ...NEW_FUNNEL.axes,
          funnelType: NEW_FUNNEL.funnelType,
        }),
      });
      console.log(res.ok
        ? `  - создана на проде (HTTP ${res.status})`
        : `  ! прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  // --- 3. Активация черновиков ---------------------------------------------
  console.log('\n## Активация черновиков');
  for (const target of ACTIVATE) {
    const mark = target.confirmedByLeak ? '' : ' (решение владельца, в ЛИК не заведена)';
    const local = localByCode(target.code);

    if (!local) {
      console.error(`  ! ${target.code} локально не найдена`);
      continue;
    }
    if (local.status === 'active') {
      console.log(`  = ${target.code}: уже active`);
    } else if (local.status !== 'draft') {
      console.error(`  ! ${target.code}: статус «${local.status}», ожидался draft — пропускаю`);
      continue;
    } else {
      const mismatch = axesMismatch(local.id, target.axes);
      if (mismatch.length) {
        console.error(`  ! ${target.code}: оси не совпали (${mismatch.join('; ')}) — пропускаю`);
        continue;
      }
      if (dryRun) {
        console.log(`  - ${target.code}: draft → active${mark}`);
      } else {
        updateFunnel(db, local.id, { status: 'active' });
        console.log(`  - ${target.code}: активирована локально${mark}`);
      }
    }

    const onProd = prodByCode.get(target.code);
    if (skipProd) {
      // прод не трогаем
    } else if (!onProd) {
      console.error(`  ! ${target.code} на проде не найдена`);
    } else if (onProd.status === 'active') {
      console.log(`  = ${target.code}: на проде уже active`);
    } else if (onProd.status !== 'draft') {
      console.error(`  ! ${target.code}: на проде статус «${onProd.status}» — пропускаю`);
    } else if (dryRun) {
      console.log(`  - ${target.code}: на проде (id=${onProd.id}) draft → active`);
    } else {
      const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
        method: 'PATCH',
        headers: prodHeaders(),
        body: JSON.stringify({ status: 'active' }),
      });
      console.log(res.ok
        ? `  - ${target.code}: активирована на проде (HTTP ${res.status})`
        : `  ! ${target.code}: прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  console.log(`\n${dryRun ? 'Это был --dry-run, ничего не записано.' : 'Готово.'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
