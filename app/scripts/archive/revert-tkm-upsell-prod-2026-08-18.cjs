/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 *
 * ЧТО ОТКАТЫВАЕМ. Заливка 18.08.2026 положила в блок «Допродажи / дожим»
 * воронок f34 и f78 по одной ссылке на ПРЕДСПИСОК:
 * gc.ksamata.ru/tkm/pre-yan и gc.ksamata.ru/tkm/pre-nr. Это не допродажи.
 *
 * ПОЧЕМУ ТАК ВЫШЛО. Разбор листа читал колонки по жёсткому номеру: колонка
 * F считалась «ссылкой на продажную страницу». На листе ТКМ раскладка
 * другая — F там «Ссылка на предсписок», продажная лежит в G, а страницы
 * ГК для тарифов в I. Правило разделения колонки F по хосту довершило
 * дело: адрес на gc.ksamata.ru уехал в допродажи. Всего таких листов семь
 * из 26 (ТКМ, ЧО, Детокс + ич, Жизнь, ЗВ, ДББ, РД), но до прода дефект
 * доехал только через ТКМ — остальные их блоки в заливку не попали.
 *
 * ПОЧЕМУ ПУСТОЙ БЛОК, А НЕ ПРАВИЛЬНЫЕ ДОПРОДАЖИ. Настоящие допродажи ТКМ
 * станут видны только после починки разбора; подставлять их сейчас значило
 * бы чинить данные тем же сломанным инструментом. Возвращаем блок в то
 * состояние, в котором он был до заливки: пусто и выключено (для вида
 * upsell это и есть значение по умолчанию, см. BLOCK_KINDS в
 * app/src/lib/blocks.ts).
 *
 * ПРОВЕРКА ДО ЗАПИСИ. `expect` — ровно тот единственный адрес, который
 * заливка туда положила. Не совпало (кто-то уже поправил руками) —
 * пропускаем, а не затираем чужую правку. Отсюда идемпотентность.
 *
 *   docker exec <c> node /tmp/revert.cjs --dry-run
 *   docker exec <c> node /tmp/revert.cjs --apply
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

const CHANGES = [
  { funnel: 'f34', kind: 'upsell', expect: ['https://gc.ksamata.ru/tkm/pre-yan'] },
  { funnel: 'f78', kind: 'upsell', expect: ['https://gc.ksamata.ru/tkm/pre-nr'] },
];

const norm = (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, '');

function sameUrlSet(a, b) {
  const x = a.map(norm).sort();
  const y = b.map(norm).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function getJson(p) {
  const res = await fetch(`${BASE}${p}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${p} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);
  const list = await getJson('/api/funnels');
  const byCode = new Map();
  for (const f of list) if (f.frontCode) byCode.set(f.frontCode, f);

  let done = 0, skipped = 0, problems = 0;
  for (const c of CHANGES) {
    const f = byCode.get(c.funnel);
    if (!f) { console.log(`  ? ${c.funnel}: нет такой воронки`); skipped++; continue; }

    let cur;
    try { cur = await getJson(`/api/funnels/${f.id}/blocks/${c.kind}`); }
    catch (e) { console.error(`  ! ${c.funnel}: ${e.message}`); problems++; continue; }

    const have = cur.items.map((i) => i.url);
    if (!sameUrlSet(have, c.expect)) {
      console.log(`  = ${c.funnel} ${c.kind}: на проде не то, что ожидали — пропускаю.`
        + `\n      ожидали: ${c.expect.map(norm).join(', ')}`
        + `\n      лежит:   ${have.map(norm).join(', ') || '(пусто)'}`);
      skipped++;
      continue;
    }

    console.log(`  ${dryRun ? '~' : '+'} ${c.funnel} ${c.kind}: гашу блок`);
    for (const u of have) console.log(`        − ${norm(u)}`);
    if (dryRun) { done++; continue; }

    const res = await fetch(`${BASE}/api/funnels/${f.id}/blocks/${c.kind}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: AUTH },
      body: JSON.stringify({ enabled: false, mode: 'common', items: [] }),
    });
    if (!res.ok) {
      console.error(`  ! ${c.funnel}: PUT → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      problems++;
      continue;
    }
    done++;
  }
  console.log(`\nИтого: ${done} ${dryRun ? 'к откату' : 'откачено'}, ${skipped} пропущено, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
