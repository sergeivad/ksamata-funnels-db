/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Базу репозитория правит swap-tariffs-applications-2026-08-13.ts — это разные базы.
 *
 * ЧТО ЧИНИМ. Содержимое блоков «Страницы тарифов» и «Оформление заявки»
 * переставлено местами по всей базе: в тарифах лежат страницы GetCourse
 * (`gc.ksamata.ru/<продукт>/tarif/<тариф>`, заголовок «Оформления заявки
 * (С куратором)»), а в заявках — страницы Tilda (`t.ksamata.ru/<продукт>/
 * tarif-<...>`, заголовок «…Тарифы 1.0»). Правило владельца: тарифы — на t.,
 * оформление заявки — на gc. Похоже на ошибку импорта, а не на правки людей:
 * подписей у позиций нет нигде, режим у обоих блоков by_time (кроме f8 и f93).
 *
 * РЕШЕНИЕ ПО ХОСТУ, А НЕ ПО СПИСКУ КОДОВ. Меняем ровно те воронки, где тарифы
 * состоят только из gc-ссылок, а заявки — только из t-ссылок (пустая сторона
 * считается подходящей). Список воронок в скрипте не зашит: он бы разошёлся с
 * продом, где своя нумерация id и есть воронки, которых нет в репозитории.
 * Смешанный случай пропускается с сообщением — так сам собой отсеивается f26,
 * где в обоих блоках t-ссылки на разные продукты (dbo против spb); её судьбу
 * решает владелец отдельно.
 *
 * МЕНЯЕТСЯ БЛОК ЦЕЛИКОМ — позиции, режим и галка включения: режим у пары
 * может различаться (у f8 и f93 тарифы «Общее», заявки «По времени»), и
 * оставить его на месте значило бы разложить ссылки не по тем колонкам.
 * У семи воронок блока тарифов нет вовсе — им он заводится, а заявки
 * остаются пустыми: gc-страниц для них в базе просто нет.
 *
 * ИДЕМПОТЕНТЕН: после обмена условие «в тарифах только gc» больше не
 * выполняется, повторный прогон ничего не делает.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; учётка берётся
 * из его же ADMIN_USERS, поэтому пароль никуда не вводится руками.
 *
 *   docker exec <container> node /app/swap-tariffs-applications-prod-2026-08-13.cjs --dry-run
 *   docker exec <container> node /app/swap-tariffs-applications-prod-2026-08-13.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

const TARIFF_HOST = 't.ksamata.ru';       // Tilda — страница с тарифами
const APPLICATION_HOST = 'gc.ksamata.ru'; // GetCourse — форма оформления заявки

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

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

/** Все позиции блока лежат на этом хосте (пустой блок подходит любому). */
function onlyHost(block, host) {
  return block.items.every((i) => hostOf(i.url) === host);
}

function describe(block) {
  const hosts = [...new Set(block.items.map((i) => hostOf(i.url) || '(не ссылка)'))];
  return `${block.items.length} поз. [${hosts.join(',') || '—'}] ${block.mode}${block.enabled ? '' : ' выкл'}`;
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function putBlock(id, kind, block) {
  const res = await fetch(`${BASE}/api/funnels/${id}/blocks/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
    body: JSON.stringify({ enabled: block.enabled, mode: block.mode, items: block.items }),
  });
  if (!res.ok) throw new Error(`PUT ${kind} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  const list = await getJson('/api/funnels');
  console.log(`Прод: ${list.length} воронок.\n`);

  let swapped = 0;
  let skipped = 0;
  let problems = 0;

  for (const f of list) {
    const label = `${f.frontCode || `#${f.id}`} (num=${f.num})`;
    const [tariffs, applications] = await Promise.all([
      getJson(`/api/funnels/${f.id}/blocks/tariffs`),
      getJson(`/api/funnels/${f.id}/blocks/applications`),
    ]);

    if (tariffs.items.length === 0 && applications.items.length === 0) continue;

    const inverted = onlyHost(tariffs, APPLICATION_HOST) && onlyHost(applications, TARIFF_HOST);
    if (!inverted) {
      const alreadyRight = onlyHost(tariffs, TARIFF_HOST) && onlyHost(applications, APPLICATION_HOST);
      console.log(
        `  ${alreadyRight ? '=' : '!'} ${label}: ${alreadyRight ? 'уже по правилу' : 'смешанный случай, пропускаю'}` +
        `\n      тарифы: ${describe(tariffs)}\n      заявки: ${describe(applications)}`
      );
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  - ${label}: тарифы ← ${describe(applications)} | заявки ← ${describe(tariffs)}`);
      swapped++;
      continue;
    }

    try {
      // Сначала тарифы: если второй PUT не пройдёт, в обоих блоках останутся
      // t-ссылки — это видно глазом и чинится повтором, в отличие от потери.
      await putBlock(f.id, 'tariffs', applications);
      await putBlock(f.id, 'applications', tariffs);
      console.log(`  - ${label}: обмен выполнен`);
      swapped++;
    } catch (e) {
      console.error(`  ! ${label}: ${e.message}`);
      problems++;
    }
  }

  console.log(`\nИтого: ${swapped} ${dryRun ? 'к обмену' : 'обменов'}, ${skipped} пропущено, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
