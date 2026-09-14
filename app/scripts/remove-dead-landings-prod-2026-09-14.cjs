/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория не трогает — для неё отдельный скрипт
 * `remove-dead-landings-2026-09-14.ts` (запускается из `app/` через tsx).
 *
 * ЗАЧЕМ. Два адреса из партии `add-landings-prod-2026-09-07.cjs` (выгрузка
 * LeakEngine за август 2026) не работали НИ РАЗУ: цели мониторинга заведены
 * 07.09 в 17:08:49, первая же проверка через шесть секунд дала 404, и в
 * `monitor_events` у обеих ровно одно событие `unknown → down` — состояния
 * `up` в истории нет вовсе. Владелец подтвердил 14.09: эти лендинги давно
 * сняты с рекламы и удалены.
 *
 *   f23 (ДБО Алексей Яндекс Реклама)   https://lp.ksamata.ru/rd_yhe
 *   f24 (БОО Алексей Яндекс Ретаргет)  https://lp.ksamata.ru/sz-ya
 *
 * Это НЕ откат всей партии: остальные 15 живых адресов той же выгрузки
 * отвечают `up` и остаются на месте.
 *
 * ПРАВИЛА:
 *   - Воронка ищется по F-коду (нормализация — `trim().toLowerCase()`).
 *     Нет такого кода на проде — сообщаем и пропускаем; это НЕ ошибка выхода.
 *   - Сравнение адресов — без учёта регистра и хвостового слэша.
 *   - Удаляются ТОЛЬКО перечисленные адреса; остальные пункты остаются как
 *     есть и в том же порядке (GET отдаёт их по позиции). `enabled` и `mode`
 *     блока переносятся из ответа GET без изменений — блок ни у одной из
 *     двух воронок не пустеет (у f23 останется 1 пункт, у f24 — 10).
 *   - Запись — `PUT /api/funnels/{id}/blocks/landings`; роут сам валидирует
 *     каждый URL через `checkUrlField`. Ответ не 2xx — печатаем тело и
 *     продолжаем с остальными, в конце ненулевой код выхода.
 *
 * МОНИТОРИНГ отдельного шага не требует: цель снимается штатным путём
 * списания (`syncMonitorTargets` — глушит, отвязывает от воронки, историю
 * инцидентов оставляет) на ближайшем цикле. Чтобы не ждать 15 минут, после
 * `--apply` дёрни `POST /api/monitoring/run`. Строку `monitor_targets`
 * руками не удаляем: в ней висит история, а вернётся адрес — цель оживёт.
 *
 * Идемпотентен: повторный `--apply` не находит адресов и не делает PUT.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; учётка
 * берётся из его же ADMIN_USERS — пароль никуда не вводится руками.
 *
 *   docker exec <c> node /tmp/remove-dead-landings-prod-2026-09-14.cjs --dry-run
 *   docker exec <c> node /tmp/remove-dead-landings-prod-2026-09-14.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

// F-код → адреса, которые надо убрать из блока «Лендинги» (см. шапку).
const PAYLOAD = {
  f23: ['https://lp.ksamata.ru/rd_yhe'],
  f24: ['https://lp.ksamata.ru/sz-ya'],
};

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

// ADMIN_USERS — «имя:пароль» через запятую; берём первую пару.
const first = String(process.env.ADMIN_USERS || '').split(',')[0].trim();
if (!first || !first.includes(':')) {
  console.error('ADMIN_USERS не задан или пуст — редактор не определён');
  process.exit(2);
}
const AUTH = 'Basic ' + Buffer.from(first).toString('base64');

/** Сравнение адресов без учёта регистра и хвостового слэша. */
function normUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

function normCode(c) {
  return String(c || '').trim().toLowerCase();
}

async function getJson(p) {
  const res = await fetch(`${BASE}${p}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${p} → HTTP ${res.status}`);
  return res.json();
}

async function putLandings(id, body) {
  const res = await fetch(`${BASE}/api/funnels/${id}/blocks/landings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT landings → HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

async function main() {
  console.log(`Прод: ${BASE}`);
  console.log(`Режим: ${dryRun ? 'ПРОБНЫЙ (ничего не пишем)' : 'ЗАПИСЬ'}\n`);

  const list = await getJson('/api/funnels');
  const byCode = new Map();
  for (const f of list) {
    const code = normCode(f.frontCode);
    if (code) byCode.set(code, f);
  }
  console.log(`Воронок на проде: ${list.length}.\n`);

  let written = 0;
  let unchanged = 0;
  let missing = 0;
  let problems = 0;

  for (const [rawCode, urls] of Object.entries(PAYLOAD)) {
    const f = byCode.get(normCode(rawCode));
    if (!f) {
      console.log(`  ? ${rawCode}: такого F-кода на проде нет — пропускаю`);
      missing++;
      continue;
    }

    let cur;
    try {
      cur = await getJson(`/api/funnels/${f.id}/blocks/landings`);
    } catch (e) {
      console.error(`  ! ${rawCode}: ${e.message}`);
      problems++;
      continue;
    }

    const drop = new Set(urls.map(normUrl));
    const keep = cur.items.filter((i) => !drop.has(normUrl(i.url)));
    const removed = cur.items.filter((i) => drop.has(normUrl(i.url))).map((i) => i.url);

    if (removed.length === 0) {
      console.log(`  = ${rawCode}: этих адресов в блоке нет (пунктов: ${cur.items.length}) — пропускаю`);
      unchanged++;
      continue;
    }

    console.log(`  ${dryRun ? '~' : '-'} ${rawCode}: было ${cur.items.length}, убираем ${removed.length}, останется ${keep.length}`);
    for (const u of removed) console.log(`        ✗ ${u}`);

    if (dryRun) {
      written++;
      continue;
    }

    try {
      await putLandings(f.id, {
        enabled: cur.enabled,
        mode: cur.mode,
        items: keep.map((i) => ({ slot: i.slot ?? null, label: i.label, url: i.url })),
      });
      written++;
    } catch (e) {
      console.error(`  ! ${rawCode}: ${e.message}`);
      problems++;
    }
  }

  console.log(
    `\nИтого: ${written} ${dryRun ? 'к правке' : 'записано'}, ${unchanged} без изменений, ` +
      `${missing} без такого F-кода на проде, ${problems} проблем.`
  );
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
