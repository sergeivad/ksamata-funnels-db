/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория не трогает.
 *
 * ЗАЧЕМ. Сверка ссылок воронок СУСТАВЫ с процессами GetCourse 13.10.2026
 * (стартовые процессы из снимка аудита `gc-funnel-audits/sustavy/runs/
 * 2026-10-13T11-19-22Z`, f110 — `sustavy/extra-2026-10-13`). Комнаты,
 * тарифы и допродажи сошлись везде, расхождений два.
 *
 * 1. Блок «ОТО» пуст у пяти воронок, хотя стартовый процесс пишет в поле
 *    `oto_sst` ссылку ОТО, и страница отвечает 200 «Специальное предложение»:
 *
 *      f32 (РСЯ, 2478095)          https://gc.ksamata.ru/sst/oto-rsya
 *      f35 (NR, 2499201)           https://gc.ksamata.ru/sst/oto-nr
 *      f63 (СЕО, 2521780)          https://gc.ksamata.ru/sst/oto-sait
 *      f53 (ИНХАУЗ ВК, 2522159)    https://gc.ksamata.ru/sst/oto-kvch
 *      f80 (ИНХАУЗ Яндекс, 2531332) https://gc.ksamata.ru/sst/oto-inya
 *
 *    У f98, f100 и f110 ОТО в базе уже есть. Блок включается
 *    (`enabled: true`), `mode` остаётся из GET. Ссылка — без меток: метки
 *    `utm_source=getcourse&utm_campaign=oto` живут только в процессе.
 *
 * 2. В блоке «Процессы» у f35, f53, f80 и f110 пятым днём стоит 2581572
 *    «5 день (правки)». Его никто не вызывает: «4 день (правки)» 2581571
 *    вызывает общий «5 день» 2466574 (аудит, timing и живые задачи 13.10).
 *    Меняется только адрес этого пункта, подпись и порядок остаются.
 *
 * Идемпотентен: повторный `--apply` ничего не находит и не делает PUT.
 *
 * Запускается ИЗНУТРИ контейнера, учётка — из его ADMIN_USERS:
 *
 *   docker exec <c> node /tmp/sustavy-oto-day5-prod-2026-10-13.cjs --dry-run
 *   docker exec <c> node /tmp/sustavy-oto-day5-prod-2026-10-13.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

const OTO = {
  f32: 'https://gc.ksamata.ru/sst/oto-rsya',
  f35: 'https://gc.ksamata.ru/sst/oto-nr',
  f63: 'https://gc.ksamata.ru/sst/oto-sait',
  f53: 'https://gc.ksamata.ru/sst/oto-kvch',
  f80: 'https://gc.ksamata.ru/sst/oto-inya',
};

const DAY5_OLD = 'https://gc.ksamata.ru/pl/tasks/mission/process?id=2581572';
const DAY5_NEW = 'https://gc.ksamata.ru/pl/tasks/mission/process?id=2466574';
const DAY5 = ['f35', 'f53', 'f80', 'f110'];

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

  const run = async (code, kind, plan) => {
    const f = byCode.get(normCode(code));
    if (!f) {
      console.log(`  ? ${code}: такого F-кода на проде нет`);
      problems++;
      return;
    }
    try {
      const cur = await getJson(`/api/funnels/${f.id}/blocks/${kind}`);
      const next = plan(cur);
      if (!next) {
        console.log(`  = ${code} ${kind}: уже как надо`);
        unchanged++;
        return;
      }
      console.log(`  ${dryRun ? '~' : '+'} ${code} ${kind}: ${next.note}`);
      if (!dryRun) await putBlock(f.id, kind, next.body);
      written++;
    } catch (e) {
      console.error(`  ! ${code} ${kind}: ${e.message}`);
      problems++;
    }
  };

  for (const [code, url] of Object.entries(OTO)) {
    await run(code, 'oto', (cur) => {
      if (cur.items.some((i) => normUrl(i.url) === normUrl(url))) return null;
      return {
        note: `добавить ${url} (было пунктов: ${cur.items.length}, enabled ${cur.enabled} → true)`,
        body: { enabled: true, mode: cur.mode, items: [...strip(cur.items), { slot: null, label: '', url }] },
      };
    });
  }

  for (const code of DAY5) {
    await run(code, 'processes', (cur) => {
      const hit = cur.items.filter((i) => normUrl(i.url) === normUrl(DAY5_OLD));
      if (hit.length === 0) return null;
      return {
        note: `«${hit.map((i) => i.label).join(', ')}»: 2581572 → 2466574`,
        body: {
          enabled: cur.enabled,
          mode: cur.mode,
          items: strip(cur.items).map((i) => (normUrl(i.url) === normUrl(DAY5_OLD) ? { ...i, url: DAY5_NEW } : i)),
        },
      };
    });
  }

  console.log(`\nИтого: ${written} ${dryRun ? 'к правке' : 'записано'}, ${unchanged} без изменений, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
