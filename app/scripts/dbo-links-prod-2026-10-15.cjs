/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория не трогает.
 *
 * ЗАЧЕМ. Сверка ссылок ДБО 15.10.2026: прод-база против 61 стартового процесса
 * GetCourse и текстов писем старых поколений. Источник —
 * `gc-funnel-audits/dbo-links-2026-10-15` (compare-2026-10-15.txt). Процесс
 * относится к воронке, чьи комнаты он записывает. Только добавляет пункты,
 * ничего не удаляет и не переставляет.
 *
 * 1. «ОТО»: процессы шлют страницы, которых в базе нет.
 *      - f86: 2538417 «Воронка ДБО (NR ADDBLOGGERS) + месс» пишет oto_dbo
 *        `dbo/oto-15-nrab` и `dbo/oto-19-nrab`;
 *      - f39: письма 1974314/1974312 «ДБО сайт 15:00/19:00» ведут на `dbo/br_mds`;
 *      - f41: письма 1974275/1974274 «ДБО партнер 15:00/19:00» — на `dbo/br_mdpr`.
 * 2. «Допродажи»: f11, 2460315 «Воронка ДБО (NR IS) + месс» пишет trfzp_dbo
 *    `t.ksamata.ru/zp/tarif-dbo-nr`.
 * 3. «Процессы»: настоящие стартовые процессы и дни.
 *      - f26: старт 2466763 (в блоке были старые 2107799 и 2087552);
 *      - f86: старт 2538417 (блока не было);
 *      - f39: 1975079 и ветки 1974314/1974312; f41: 1975066 и 1974275/1974274.
 *    Новые старты вызывают дни «(правки)» 2502688 → … → 2504892, повторы
 *    3–5 дня запускаются из дней.
 *
 * Все страницы ОТО и ЗП отвечают 200 на 15.10.2026.
 * Идемпотентен: пункт с тем же адресом не добавляется второй раз.
 *
 *   docker exec <c> node /tmp/dbo-links-prod-2026-10-15.cjs --dry-run
 *   docker exec <c> node /tmp/dbo-links-prod-2026-10-15.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';
const GC = 'https://gc.ksamata.ru';
const proc = (id) => `${GC}/pl/tasks/mission/process?id=${id}`;

const NEW_CHAIN = [
  { label: 'День 1', url: proc(2502688) },
  { label: 'День 2', url: proc(2503512) },
  { label: 'День 3', url: proc(2504531) },
  { label: 'День 4', url: proc(2504723) },
  { label: 'День 5', url: proc(2504892) },
  { label: 'Повторы дня 3', url: proc(2595997) },
  { label: 'Повторы дня 4', url: proc(2596040) },
  { label: 'Повторы дня 5', url: proc(2597327) },
];

// kind → { mode, items }; slot null — общий пункт
const PLAN = {
  f86: {
    oto: {
      mode: 'by_time',
      items: [
        { slot: '15', label: '', url: `${GC}/dbo/oto-15-nrab` },
        { slot: '19', label: '', url: `${GC}/dbo/oto-19-nrab` },
      ],
    },
    processes: { mode: 'common', items: [{ slot: null, label: 'Вход', url: proc(2538417) }, ...NEW_CHAIN.map((i) => ({ slot: null, ...i }))] },
  },
  f39: {
    oto: { mode: 'common', items: [{ slot: null, label: '', url: `${GC}/dbo/br_mds` }] },
    processes: {
      mode: 'common',
      items: [
        { slot: null, label: 'Вход', url: proc(1975079) },
        { slot: null, label: '15:00', url: proc(1974314) },
        { slot: null, label: '19:00', url: proc(1974312) },
      ],
    },
  },
  f41: {
    oto: { mode: 'common', items: [{ slot: null, label: '', url: `${GC}/dbo/br_mdpr` }] },
    processes: {
      mode: 'common',
      items: [
        { slot: null, label: 'Вход', url: proc(1975066) },
        { slot: null, label: '15:00', url: proc(1974275) },
        { slot: null, label: '19:00', url: proc(1974274) },
      ],
    },
  },
  f11: {
    upsell: { mode: 'common', items: [{ slot: null, label: '', url: 'https://t.ksamata.ru/zp/tarif-dbo-nr' }] },
  },
  f26: {
    processes: { mode: 'common', items: [{ slot: null, label: 'Вход', url: proc(2466763) }, ...NEW_CHAIN.map((i) => ({ slot: null, ...i }))] },
  },
};

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

const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
const normCode = (c) => String(c || '').trim().toLowerCase();

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

const strip = (items) => items.map((i) => ({ slot: i.slot ?? null, label: i.label, url: i.url }));

async function main() {
  console.log(`Прод: ${BASE}`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const byCode = new Map();
  for (const f of await getJson('/api/funnels')) byCode.set(normCode(f.frontCode), f);

  let written = 0;
  let unchanged = 0;
  let problems = 0;

  for (const [code, kinds] of Object.entries(PLAN)) {
    const f = byCode.get(normCode(code));
    if (!f) {
      console.log(`  ? ${code}: такого F-кода на проде нет`);
      problems++;
      continue;
    }
    for (const [kind, want] of Object.entries(kinds)) {
      try {
        const cur = await getJson(`/api/funnels/${f.id}/blocks/${kind}`);
        const items = cur.items || [];
        const have = new Set(items.map((i) => normUrl(i.url)));
        const add = want.items.filter((w) => !have.has(normUrl(w.url)));
        // Режим «по времени» ставим, только если блок пуст: заполненный блок
        // уже размечен, и смена режима перепутала бы его строки.
        const mode = items.length > 0 ? cur.mode : want.mode;
        if (items.length > 0 && cur.mode === 'common' && add.some((a) => a.slot)) {
          console.error(`  ! ${code} ${kind}: блок общий, а пункты по времени — пропускаю`);
          problems++;
          continue;
        }
        if (add.length === 0) {
          console.log(`  = ${code} ${kind}: уже как надо`);
          unchanged++;
          continue;
        }
        console.log(`  ${dryRun ? '~' : '+'} ${code} ${kind} (${mode}): +${add.length} (было ${items.length})`);
        for (const a of add) console.log(`      ${a.slot || 'общ.'} | ${a.label || '—'} | ${a.url}`);
        const body = { enabled: true, mode, items: [...strip(items), ...strip(add)] };
        if (!dryRun) await putBlock(f.id, kind, body);
        written++;
      } catch (e) {
        console.error(`  ! ${code} ${kind}: ${e.message}`);
        problems++;
      }
    }
  }

  console.log(`\nИтого: ${written} ${dryRun ? 'к правке' : 'записано'}, ${unchanged} без изменений, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
