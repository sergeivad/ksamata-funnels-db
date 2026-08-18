/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория этот скрипт НЕ трогает и его .ts-двойника не существует:
 * решение владельца 18.08.2026 — заливаем только прод. Репозиторная база уже
 * отстаёт от прода на 9 блоков, и дозаливка 45 сделала бы её «почти
 * актуальной», что хуже честного «устарела».
 *
 * ЧТО ЗАЛИВАЕМ. Раздел «Можно залить» отчёта tools/sheet-links: тарифы,
 * оформление заявки и допродажи, которые есть в гугл-таблице «Воронки
 * ссылки» и которых нет в воронке. План лежит рядом в
 * fill-sheet-links-prod-2026-08-18.plan.json — он собран
 * `run_sheet_links.py --plan` и закоммичен как запись о том, что именно
 * было записано.
 *
 * ПИШЕМ ТОЛЬКО В ПУСТОЙ БЛОК. Непустой пропускается с сообщением, даже
 * если содержимое отличается: расхождение — решение человека, а PUT
 * заменяет блок целиком и стёр бы правку маркетолога. Отсюда же
 * идемпотентность: после успешного прогона все целевые блоки непусты, и
 * повторный запуск не делает ничего.
 *
 * СОСТОЯНИЕ СПРАШИВАЕМ У ПРОДА, А НЕ У ПЛАНА. План собран по базе
 * репозитория, а она разошлась с продом: замер 18.08.2026 нашёл 9 блоков,
 * заполненных на проде и пустых в репозитории. Три из них попадают в план
 * (f58 допродажи, f84 тарифы и заявки) — все три отсеются этой проверкой.
 *
 * ВОРОНКА ИЩЕТСЯ ПО F-КОДУ. `id` на проде своя нумерация: там 76 воронок
 * против репозиторных, и совпадения id не гарантировано. `num` не
 * используем вовсе — он внутренний.
 *
 * РЕЖИМ И СЛОТ БЕРУТСЯ ИЗ ПЛАНА КАК ЕСТЬ. Правила их вывода живут в
 * tools/sheet-links/links_plan.py вместе с замерами, которые их обосновали;
 * дублировать их здесь значило бы завести второй источник истины.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; учётка
 * берётся из его же ADMIN_USERS, поэтому пароль никуда не вводится руками.
 *
 *   docker exec <container> node /tmp/fill-sheet-links-prod-2026-08-18.cjs \
 *     --plan /tmp/fill-sheet-links-prod-2026-08-18.plan.json --dry-run
 *   docker exec <container> node /tmp/fill-sheet-links-prod-2026-08-18.cjs \
 *     --plan /tmp/fill-sheet-links-prod-2026-08-18.plan.json --apply
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

const planIdx = process.argv.indexOf('--plan');
const planPath = planIdx >= 0 && process.argv[planIdx + 1]
  ? process.argv[planIdx + 1]
  : path.join(__dirname, 'fill-sheet-links-prod-2026-08-18.plan.json');

// ADMIN_USERS — «имя:пароль» через запятую; берём первую пару.
const first = String(process.env.ADMIN_USERS || '').split(',')[0].trim();
if (!first || !first.includes(':')) {
  console.error('ADMIN_USERS не задан или пуст — редактор не определён');
  process.exit(2);
}
const AUTH = 'Basic ' + Buffer.from(first).toString('base64');

/** Сравнение адресов — как в links_compare.normalize_url: регистр и хвостовые слэши. */
function normUrl(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}

function sameContent(planItems, blockItems) {
  const key = (i) => `${i.slot === undefined ? null : i.slot}|${normUrl(i.url)}`;
  const a = planItems.map(key).sort();
  const b = blockItems.map(key).sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
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
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const positions = plan.blocks.reduce((n, b) => n + b.items.length, 0);
  console.log(`План от ${plan.generated}: ${plan.blocks.length} блоков, ${positions} позиций.`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const list = await getJson('/api/funnels');
  const byCode = new Map();
  for (const f of list) if (f.frontCode) byCode.set(f.frontCode, f);
  console.log(`Прод: ${list.length} воронок.\n`);

  let written = 0, occupied = 0, missing = 0, problems = 0;

  for (const b of plan.blocks) {
    const f = byCode.get(b.funnel);
    if (!f) {
      console.log(`  ? ${b.funnel} ${b.kind}: воронки с таким F-кодом на проде нет`);
      missing++;
      continue;
    }
    if (f.status !== 'active') {
      console.log(`  ? ${b.funnel} ${b.kind}: на проде статус «${f.status}», пропускаю`);
      missing++;
      continue;
    }

    let existing;
    try {
      existing = await getJson(`/api/funnels/${f.id}/blocks/${b.kind}`);
    } catch (e) {
      console.error(`  ! ${b.funnel} ${b.kind}: ${e.message}`);
      problems++;
      continue;
    }

    if (existing.items.length > 0) {
      const verdict = sameContent(b.items, existing.items)
        ? 'уже ровно то же самое'
        : `ОТЛИЧАЕТСЯ (на проде ${existing.items.length} поз., в плане ${b.items.length})`;
      console.log(`  = ${b.funnel} ${b.kind}: блок непустой — ${verdict}`);
      occupied++;
      continue;
    }

    if (dryRun) {
      console.log(`  + ${b.funnel} ${b.kind} [${b.mode}]: ${b.items.length} поз.`);
      for (const i of b.items) console.log(`        ${i.slot || '—'}  ${i.url}`);
      written++;
      continue;
    }

    try {
      await putBlock(f.id, b.kind, { enabled: b.enabled, mode: b.mode, items: b.items });
      console.log(`  + ${b.funnel} ${b.kind} [${b.mode}]: записано ${b.items.length} поз.`);
      written++;
    } catch (e) {
      console.error(`  ! ${b.funnel} ${b.kind}: ${e.message}`);
      problems++;
    }
  }

  console.log(
    `\nИтого: ${written} ${dryRun ? 'к записи' : 'записано'}, ` +
    `${occupied} занято на проде, ${missing} без воронки, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
