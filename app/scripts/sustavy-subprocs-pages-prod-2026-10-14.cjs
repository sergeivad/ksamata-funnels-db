/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория не трогает.
 *
 * ЗАЧЕМ. Продолжение сверки 13.10.2026 (`sustavy-oto-day5-prod-2026-10-13.cjs`).
 * Источник — снимок аудита `gc-funnel-audits/sustavy/runs/2026-10-13T11-19-22Z`
 * (граф подпроцессов из funnel.json, виджеты и страницы из sources.json),
 * f110 — `sustavy/extra-2026-10-13`. Только добавляет пункты, ничего не
 * удаляет и не переставляет.
 *
 * 1. «Процессы»: в блоке были только мини-процесс и пять дней. Дописываются
 *    подпроцессы, которые цепочка реально вызывает:
 *      - SMS: 2557339 «смс (первый день)» у f32; 2557326 «смс (все дни)»
 *        у f35, f53, f110 (у f63, f80, f98, f100 блока SMS нет);
 *      - дожимы 3 и 4 дня 2591065, 2591067 и перелив на ДБО 2433073,
 *        2433153 — у всех восьми;
 *      - 2548429 «Снимок ссылок регистрационного заказа» (запускает виджет)
 *        и 2600591 «Отправить бонус после подключения мессенджера»
 *        (запускает страница «спасибо») — у семи, кроме f110: его виджета
 *        в снимке нет.
 *    «АВ СУСТАВЫ дожим 5 день» из 5 дня не вносится: в блоке подпроцесса
 *    нет адреса процесса (missionId пуст), а угадывать его нельзя.
 *
 * 2. «Ссылки»: виджет регистрации (редактор `pl/lite/widget/editor?id=`) и
 *    страница «спасибо», на которую он ведёт. У f32 виджетов четыре.
 *    У f110 не вносится — виджета в снимке нет.
 *
 * 3. «Допродажи»: страница заявки с куратором была только у f63, f98, f100.
 *    Дописывается остальным пяти. Все пять отвечают 200 «Оформления заявки
 *    (С куратором)» на 14.10.2026; у f53 это `curator-sst-invk`
 *    (`curator-sst-kvch` отдаёт 404).
 *
 * Идемпотентен: пункт с тем же адресом не добавляется второй раз.
 *
 *   docker exec <c> node /tmp/sustavy-subprocs-pages-prod-2026-10-14.cjs --dry-run
 *   docker exec <c> node /tmp/sustavy-subprocs-pages-prod-2026-10-14.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';
const GC = 'https://gc.ksamata.ru';
const proc = (id) => `${GC}/pl/tasks/mission/process?id=${id}`;
const widget = (id) => `${GC}/pl/lite/widget/editor?id=${id}`;

const ALL = ['f32', 'f35', 'f63', 'f53', 'f80', 'f98', 'f100', 'f110'];
const WITH_WIDGET = ALL.filter((c) => c !== 'f110');

const SMS = {
  f32: { label: 'СМС (первый день)', url: proc(2557339) },
  f35: { label: 'СМС (все дни)', url: proc(2557326) },
  f53: { label: 'СМС (все дни)', url: proc(2557326) },
  f110: { label: 'СМС (все дни)', url: proc(2557326) },
};

const COMMON_PROCS = [
  { label: 'Дожимы 3 день', url: proc(2591065) },
  { label: 'Дожимы 4 день', url: proc(2591067) },
  { label: 'Перелив на ДБО', url: proc(2433073) },
  { label: 'Перелив на ДБО 19:00', url: proc(2433153) },
];

const WIDGET_PROCS = [
  { label: 'Снимок ссылок регистрационного заказа', url: proc(2548429) },
  { label: 'Бонус после подключения мессенджера', url: proc(2600591) },
];

// виджет регистрации → страница «спасибо», куда он ведёт
const WIDGETS = {
  f32: [
    [1611166, '/sust/thx/rsya'],
    [1632558, '/sust/thx/rsya/b'],
    [1632566, '/sust/thx/rsya/c'],
    [1653003, '/sust/thx/rsya/d'],
  ],
  f35: [[1619561, '/sust/thx/nr']],
  f63: [[1629568, '/sust/sait/a']],
  f53: [[1629737, '/sust/thx/inhaus']],
  f80: [[1634413, '/sust/thx/inhousya']],
  f98: [[1652109, '/sust/thx/ht']],
  f100: [[1655814, '/sust/thx/rb']],
};

const CURATOR = {
  f32: `${GC}/zp/tarif/curator-sst-rsya`,
  f35: `${GC}/zp/tarif/curator-sst-nr`,
  f53: `${GC}/zp/tarif/curator-sst-invk`,
  f80: `${GC}/zp/tarif/curator-sst-inya`,
  f110: `${GC}/zp/tarif/curator-sst-inhvkab`,
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

function plan(code) {
  const out = { processes: [], links: [], upsell: [] };
  if (SMS[code]) out.processes.push(SMS[code]);
  out.processes.push(...COMMON_PROCS);
  if (WITH_WIDGET.includes(code)) out.processes.push(...WIDGET_PROCS);
  const ws = WIDGETS[code] || [];
  for (const [id, path] of ws) {
    const tail = ws.length > 1 ? ` (виджет ${id})` : '';
    out.links.push({ label: `Виджет регистрации ${id}`, url: widget(id) });
    out.links.push({ label: `Страница «спасибо»${tail}`, url: `${GC}${path}` });
  }
  if (CURATOR[code]) out.upsell.push({ label: '', url: CURATOR[code] });
  return out;
}

async function main() {
  console.log(`Прод: ${BASE}`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const byCode = new Map();
  for (const f of await getJson('/api/funnels')) byCode.set(normCode(f.frontCode), f);

  let written = 0;
  let unchanged = 0;
  let problems = 0;

  for (const code of ALL) {
    const f = byCode.get(normCode(code));
    if (!f) {
      console.log(`  ? ${code}: такого F-кода на проде нет`);
      problems++;
      continue;
    }
    for (const [kind, want] of Object.entries(plan(code))) {
      if (want.length === 0) continue;
      try {
        const cur = await getJson(`/api/funnels/${f.id}/blocks/${kind}`);
        const have = new Set(cur.items.map((i) => normUrl(i.url)));
        const add = want.filter((w) => !have.has(normUrl(w.url)));
        if (add.length === 0) {
          console.log(`  = ${code} ${kind}: уже как надо`);
          unchanged++;
          continue;
        }
        console.log(`  ${dryRun ? '~' : '+'} ${code} ${kind}: +${add.length} (было ${cur.items.length})`);
        for (const a of add) console.log(`      ${a.label || '—'} | ${a.url}`);
        const body = {
          enabled: true,
          mode: cur.mode,
          items: [...strip(cur.items), ...add.map((a) => ({ slot: null, label: a.label, url: a.url }))],
        };
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
