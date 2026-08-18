/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория не трогает: решение владельца 18.08.2026 — заливаем
 * только прод.
 *
 * ЧТО ЧИНИМ. Раздел «Расхождения» отчёта tools/sheet-links, пересчитанного
 * против прода 18.08.2026. Из семи воронок раздела правятся три; остальные
 * четыре (f7, f23, f31, f50) — не ошибки, там база просто богаче таблицы:
 * в допродажах стоят тарифные страницы ДРУГОГО продукта
 * (`t.ksamata.ru/zp/tarif-*` → «ПОЗВОНОЧНИК БЕЗ БОЛЕЙ И ОГРАНИЧЕНИЙ»),
 * а это ровно то, чем допродажа и является. Таблица такие связки не ведёт.
 *
 *   f26 «Оформление заявки» — ПОРЧА. В блоке лежат шесть тарифных страниц
 *     чужого продукта: `t.ksamata.ru/spb/tarif-*` → «Здоровые суставы и
 *     позвоночник. Тарифы 1.0 (Яндекс Ретаргет)», при том что воронка —
 *     ДБО. Три ошибки разом: не тот продукт, не тот хост (заявка всегда на
 *     gc.ksamata.ru, тарифы на t.ksamata.ru — правило владельца, см.
 *     archive/swap-tariffs-applications-prod-2026-08-13.cjs) и не тот вид
 *     страницы. Префикс `spb` не встречается больше НИГДЕ в базе прода —
 *     значит это не «перепутали две воронки», а занесённый однажды мусор,
 *     который никакой другой воронке не нужен. Решение владельца 18.08:
 *     удалить, не перенося в допродажи. Тарифы у f26 при этом правильные и
 *     с таблицей сходятся — испорчен ровно один блок.
 *
 *   f8 «Оформление заявки» — решение владельца при недоказуемости. В базе
 *     один `curator-ym` без слота, в таблице пара `curator-y` (19) и
 *     `y-curator` (15). Все три страницы живы и называются одинаково
 *     («Оформления заявки (С куратором)»), различить их снаружи нельзя.
 *     Косвенно таблица правее: тот же приём разведения 19/15 стоит у f81
 *     (`curator-yo`/`yo-curator`), а `-ym` не встречается в базе больше
 *     нигде. Владелец 18.08 выбрал таблицу. Блок заодно переходит из
 *     режима «Общее» в «По времени» — иначе разведение по слотам некуда
 *     положить.
 *
 *   f58 «Допродажи» — в базе не хватает двух живых адресов таблицы
 *     (`abl-boodbbytn`, `meditation-boodbbytn` → «Реальная медитация»).
 *     Существующий `zp/tarif-boo-nimb` СОХРАНЯЕТСЯ: это законная допродажа
 *     чужого продукта, как у f7/f23/f50. Дописывание, а не замена.
 *
 * ПРОВЕРКА ДО ЗАПИСИ. В отличие от скрипта заливки, этот УДАЛЯЕТ данные:
 * PUT заменяет блок целиком. Поэтому у каждой правки есть `expect` — набор
 * адресов, который обязан лежать на проде сейчас. Не совпало (кто-то
 * поправил руками, прогон уже был) — правка пропускается, а не
 * применяется поверх чужой. Отсюда же идемпотентность: после успешного
 * прогона `expect` не совпадёт, и повтор ничего не сделает.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; учётка
 * берётся из его же ADMIN_USERS.
 *
 *   docker exec <c> node /tmp/fix.cjs --dry-run
 *   docker exec <c> node /tmp/fix.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

const first = String(process.env.ADMIN_USERS || '').split(',')[0].trim();
if (!first || !first.includes(':')) {
  console.error('ADMIN_USERS не задан или пуст — редактор не определён');
  process.exit(2);
}
const AUTH = 'Basic ' + Buffer.from(first).toString('base64');

const GC = 'https://gc.ksamata.ru';
const T = 'https://t.ksamata.ru';

const CHANGES = [
  {
    funnel: 'f26',
    kind: 'applications',
    what: 'заменить шесть тарифов чужого продукта на заявки ДБО из таблицы',
    expect: [
      `${T}/spb/tarif-1yr`, `${T}/spb/tarif-yr1`, `${T}/spb/tarif-2yr`,
      `${T}/spb/tarif-yr2`, `${T}/spb/tarif-zyr`, `${T}/spb/tarif-yrz`,
    ],
    mode: 'by_time',
    items: [
      { slot: '19', label: '', url: `${GC}/dbo/tarif/curator-19-yanr` },
      { slot: '19', label: '', url: `${GC}/dbo/tarif/max-19-yanr` },
      { slot: '19', label: '', url: `${GC}/dbo/tarif/max-int-19-yanr` },
      { slot: '15', label: '', url: `${GC}/dbo/tarif/curator-15-yanr` },
      { slot: '15', label: '', url: `${GC}/dbo/tarif/max-15-yanr` },
      { slot: '15', label: '', url: `${GC}/dbo/tarif/max-int-15-yanr` },
    ],
  },
  {
    funnel: 'f8',
    kind: 'applications',
    what: 'заменить один общий адрес парой по времени из таблицы',
    expect: [`${GC}/zkt/tarif/curator-ym`],
    mode: 'by_time',
    items: [
      { slot: '19', label: '', url: `${GC}/zkt/tarif/curator-y` },
      { slot: '15', label: '', url: `${GC}/zkt/tarif/y-curator` },
    ],
  },
  {
    funnel: 'f58',
    kind: 'upsell',
    what: 'дописать два адреса таблицы, сохранив допродажу чужого продукта',
    expect: [`${T}/zp/tarif-boo-nimb`],
    mode: 'common',
    items: [
      { slot: null, label: '', url: `${T}/zp/tarif-boo-nimb` },
      { slot: null, label: '', url: `${GC}/abl-boodbbytn` },
      { slot: null, label: '', url: `${GC}/meditation-boodbbytn` },
    ],
  },
];

function normUrl(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}

function sameUrlSet(a, b) {
  const x = a.map(normUrl).sort();
  const y = b.map(normUrl).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function getJson(p) {
  const res = await fetch(`${BASE}${p}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${p} → HTTP ${res.status}`);
  return res.json();
}

async function putBlock(id, kind, body) {
  const res = await fetch(`${BASE}/api/funnels/${id}/blocks/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT ${kind} → HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

async function main() {
  console.log(`Правок в списке: ${CHANGES.length}.`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const list = await getJson('/api/funnels');
  const byCode = new Map();
  for (const f of list) if (f.frontCode) byCode.set(f.frontCode, f);

  let done = 0, skipped = 0, problems = 0;

  for (const c of CHANGES) {
    const f = byCode.get(c.funnel);
    if (!f) {
      console.log(`  ? ${c.funnel} ${c.kind}: воронки с таким F-кодом на проде нет`);
      skipped++;
      continue;
    }

    let cur;
    try {
      cur = await getJson(`/api/funnels/${f.id}/blocks/${c.kind}`);
    } catch (e) {
      console.error(`  ! ${c.funnel} ${c.kind}: ${e.message}`);
      problems++;
      continue;
    }

    const have = cur.items.map((i) => i.url);
    if (!sameUrlSet(have, c.expect)) {
      console.log(
        `  = ${c.funnel} ${c.kind}: на проде НЕ то, что ожидали — пропускаю.` +
        `\n      ожидали: ${c.expect.map(normUrl).sort().join(', ')}` +
        `\n      лежит:   ${have.map(normUrl).sort().join(', ') || '(пусто)'}`);
      skipped++;
      continue;
    }

    console.log(`  ${dryRun ? '~' : '+'} ${c.funnel} ${c.kind} [${c.mode}]: ${c.what}`);
    for (const u of c.expect) console.log(`        − ${normUrl(u)}`);
    for (const i of c.items) console.log(`        → ${i.slot || '—'}  ${i.url}`);
    if (dryRun) { done++; continue; }

    try {
      await putBlock(f.id, c.kind, { enabled: true, mode: c.mode, items: c.items });
      done++;
    } catch (e) {
      console.error(`  ! ${c.funnel} ${c.kind}: ${e.message}`);
      problems++;
    }
  }

  console.log(
    `\nИтого: ${done} ${dryRun ? 'к правке' : 'исправлено'}, ` +
    `${skipped} пропущено, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
