/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория не трогает — для неё отдельный скрипт
 * `add-landings-2026-09-07.ts` (запускается из `app/` через tsx).
 *
 * ЗАЧЕМ И НА КАКИХ ДАННЫХ. Источник — выгрузка LeakEngine за август 2026
 * (`~/Downloads/leakengine_landings_by_funnel_august_2026.xlsx`): уникальные
 * лендинги по воронкам, реально принимавшие трафик, query/UTM/fragment в
 * адресах срезаны. Блок «Лендинги» собирался вручную и по таблице
 * маркетологов, а не из ЛИК, поэтому часть посадочных страниц в него не
 * попала. Скрипт ТОЛЬКО дописывает недостающее в конец существующего
 * списка — ничего не удаляет и не переупорядочивает: 38 воронок, 74 адреса
 * из выгрузки (тот же PAYLOAD, что и в скрипте для базы репозитория).
 *
 * Одна строка выгрузки исключена руками ДО попадания в этот файл: f19 /
 * `https://t.ksamata.ru/` — это «Личный кабинет» ksamata, а не лендинг
 * воронки, и в PAYLOAD ниже её нет.
 *
 * ПРАВИЛА:
 *   - Воронка ищется по F-коду (нормализация — `trim().toLowerCase()`, тот же
 *     смысл, что у `normalizeFrontCode` в базе). Нет такого кода на проде —
 *     сообщаем и пропускаем; это НЕ ошибка выхода — на проде свой набор
 *     воронок, отличный от репозитория.
 *   - Слияние — без учёта регистра и хвостового слэша
 *     (`u.trim().replace(/\/+$/,'').toLowerCase()`). Адрес уже есть в блоке —
 *     пропускаем; существующие пункты остаются как есть и в том же порядке
 *     (GET отдаёт их по позиции), новые дописываются в конец в порядке из
 *     выгрузки.
 *   - Запись — `PUT /api/funnels/{id}/blocks/landings`. Роут сам валидирует
 *     каждый URL через `checkUrlField` и отвечает 400 на «слипшийся» адрес.
 *     Ответ не 2xx — печатаем тело ошибки и продолжаем с остальными
 *     воронками, а в конце выходим с ненулевым кодом, если хоть одна не
 *     записалась.
 *   - Воронка, которой дописывать нечего (все адреса уже в блоке), вообще не
 *     трогается — PUT для неё не вызывается.
 *   - У новых пунктов `slot: null`, `label: ''` — так устроены существующие
 *     пункты блока «Лендинги»; подписи из выгрузки не переносим.
 *   - Блок, в который дописываем, включаем (`enabled: true`) — прецедент
 *     Phase 10 (см. CLAUDE.md); режим (`mode`) берём тем, что уже стоит у
 *     блока по ответу GET.
 *
 * Идемпотентен: повторный `--apply` не находит новых адресов ни у одной
 * воронки и не делает ни одного PUT.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; учётка
 * берётся из его же ADMIN_USERS — пароль никуда не вводится руками.
 *
 *   docker exec <c> node /tmp/add-landings-prod-2026-09-07.cjs --dry-run
 *   docker exec <c> node /tmp/add-landings-prod-2026-09-07.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

// F-код → лендинги из выгрузки LeakEngine за август 2026 (см. шапку выше).
// Исключение: f19 / https://t.ksamata.ru/ («Личный кабинет») сюда не входит.
const PAYLOAD = {
  f7: [
    'https://land.zhizn-bez-boli.ru/sustavy/a',
    'https://t.sustavy-spina.ru/',
    'https://t.sustavy-spina.ru/spb',
    'https://t.zhizn-bez-boli.ru/',
    'https://t.zhizn-bez-boli.ru/2',
  ],
  f9: [
    'https://land.tirolab.ru/rsya/tirol/a',
    'https://t.tirolab.ru/rsya/shzh/a',
  ],
  f11: [
    'https://t.ksamata.ru/nr/dbo/a',
  ],
  f13: [
    'https://t.ksamata.ru/nr/zkt/b',
  ],
  f15: [
    'https://t.ksamata.ru/nr/dbo/a',
    'https://t.ksamata.ru/nr/dbo/b',
  ],
  f19: [
    'https://t.ksamata.ru/ht/boo/a',
    'https://t.ksamata.ru/ht/boo/c',
    'https://t.ksamata.ru/sust-ht',
  ],
  f21: [
    'https://lp.ksamata.ru/sh-izh/yh',
  ],
  f22: [
    'https://lp.ksamata.ru/detox_ya',
    'https://lp.ksamata.ru/detox-yhe',
    'https://lp.ksamata.ru/rd_yan',
    'https://lp.ksamata.ru/sh-izh/yh',
    'https://lp.ksamata.ru/zmk_ya',
  ],
  f23: [
    'https://lp.ksamata.ru/rd_yan',
    'https://lp.ksamata.ru/rd_yhe',
  ],
  f24: [
    'https://gc.ksamata.ru/detoks_ya',
    'https://gc.ksamata.ru/rd_ya',
    'https://gc.ksamata.ru/zm_ya',
    'https://lp.ksamata.ru/detoks_ya',
    'https://lp.ksamata.ru/detox_ya',
    'https://lp.ksamata.ru/rd_ya',
    'https://lp.ksamata.ru/rd_yan',
    'https://lp.ksamata.ru/sh-izh-yr',
    'https://lp.ksamata.ru/sz-ya',
    'https://lp.ksamata.ru/zm_ya',
    'https://lp.ksamata.ru/zmk_ya',
  ],
  f25: [
    'https://lp.ksamata.ru/sh-izh-yr',
  ],
  f26: [
    'https://lp.ksamata.ru/rd_ya',
  ],
  f27: [
    'https://quiz-light.ksamata.ru/quiz/nr',
    'https://quiz-zkt.ksamata.ru/quiz/nr',
    'https://quiz.ksamata.ru/quiz/nr',
    'https://t.ksamata.ru/jivo/nr/a',
    'https://t.ksamata.ru/nr/zkt/b',
    'https://t.ksamata.ru/nr/zkt/d',
  ],
  f28: [
    'https://lp.ksamata.ru/detox_inhaus',
    'https://t.ksamata.ru/inhaus/boo/a',
    'https://t.ksamata.ru/inhaus/boo/b',
  ],
  f29: [
    'https://lp.ksamata.ru/vknimb/svs/a',
  ],
  f30: [
    'https://t.ksamata.ru/faq/dih/a',
    'https://t.ksamata.ru/jivo/faq/a',
  ],
  f31: [
    'https://t.ksamata.ru/dih/rsya/a',
  ],
  f32: [
    'https://t.sust-bez-problem.ru/sust/rsya/a',
  ],
  f34: [
    'https://t.ksamata.ru/ttk/rsya/a',
  ],
  f35: [
    'https://t.ksamata.ru/sust/nr/a',
  ],
  f42: [
    'https://t.zhkt-start.ru/zkt/rsya/b',
  ],
  f45: [
    'https://gc.sustav-zdorov.ru/jivo/sust/nimb/a',
    'https://t.sustavy-start.ru/jivo/trial/nimb/a',
    'https://t.sustavy-start.ru/jivo/trial/nimb/e',
  ],
  f46: [
    'https://gc.ksamata.ru/jivo/sust/inhouse/b',
    'https://t.ksamata.ru/jivo/trial/inhouse/a',
  ],
  f48: [
    'https://t.ksamata.ru/jivo/trial/zhkt/inhouse/a',
  ],
  f50: [
    'https://t.danila-susak.com/nimb/dbo/a',
  ],
  f51: [
    'https://t.ksamata.ru/jivo/trial/inhouse/a',
    'https://t.ksamata.ru/trial/inhouse/a',
  ],
  f52: [
    'https://t.ksamata.ru/inhaus/dih/a',
  ],
  f53: [
    'https://t.ksamata.ru/sust/inhaus/a',
  ],
  f54: [
    'https://t.zabota-o-zhkt.ru/jivo/trial/zhkt/nimb/a',
  ],
  f55: [
    'https://t.zdravo-telo.ru/rsy/trial/inhouse/a',
  ],
  f56: [
    'https://t.zdravo-telo.ru/rsy/jivo/trial/inhouse/a',
  ],
  f57: [
    'https://t.zdravo-telo.ru/rsy/jivo/trial/zhkt/inhouse/a',
  ],
  f58: [
    'https://t.danila-susak.com/nimb/boo/a',
    'https://t.danila-susak.com/nimb/boo/b',
  ],
  f73: [
    'https://t.ksamata.ru/trial/nr/a',
  ],
  f74: [
    'https://t.ksamata.ru/jivo/trial/zhkt/nr/a',
  ],
  f80: [
    'https://t.ksamata.ru/sust/inhousya/a',
  ],
  f84: [
    'https://t.ksamata.ru/inhaus/dbo/a',
  ],
  f85: [
    'https://t.ksamata.ru/jivo/trial/nr/a',
  ],
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

    const existingNorm = new Set(cur.items.map((i) => normUrl(i.url)));
    const toAdd = urls.filter((u) => !existingNorm.has(normUrl(u)));

    if (toAdd.length === 0) {
      console.log(
        `  = ${rawCode}: все ${urls.length} адресов уже в блоке (пунктов: ${cur.items.length}) — пропускаю`
      );
      unchanged++;
      continue;
    }

    const items = [
      ...cur.items.map((i) => ({ slot: i.slot ?? null, label: i.label, url: i.url })),
      ...toAdd.map((u) => ({ slot: null, label: '', url: u })),
    ];

    console.log(`  ${dryRun ? '~' : '+'} ${rawCode}: было ${cur.items.length}, дописываем ${toAdd.length}`);
    for (const u of toAdd) console.log(`        → ${u}`);

    if (dryRun) {
      written++;
      continue;
    }

    try {
      await putLandings(f.id, { enabled: true, mode: cur.mode, items });
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
  // Отсутствие F-кода на проде — не ошибка выхода (свой набор воронок).
  // Ошибка выхода — только реальный сбой записи/чтения.
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
