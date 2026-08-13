/**
 * ЦЕЛЬ — ПРОД (/data/ksamata_funnels.db), через его собственный HTTP API.
 * Локальную базу правит assign-front-codes-2026-08-13.ts — это разные базы.
 *
 * Запускается ИЗНУТРИ контейнера: в нём нет tsx, поэтому .cjs; и учётка
 * берётся из его же ADMIN_USERS, поэтому пароль никуда не вводится руками.
 *
 * Связь по `num`: id у прода и базы репозитория свои (у F86 прод 83,
 * репозиторий 80), `num` совпадает. Дополнительно сверяется productName.
 *
 *   docker exec -it <container> node /app/scripts/assign-front-codes-prod-2026-08-13.cjs --dry-run
 *   docker exec -it <container> node /app/scripts/assign-front-codes-prod-2026-08-13.cjs --apply
 */
const BASE = process.env.SELF_BASE_URL || 'http://127.0.0.1:3000';

const TARGETS = [
  { num: 10, code: 'f87', productName: 'СВС НИМБ РСЯ' },
  { num: 14, code: 'f88', productName: 'ЖКТ NR МП' },
  { num: 17, code: 'f89', productName: 'ДБО FAQ MAX' },
  { num: 18, code: 'f90', productName: 'ДБО HT ВК' },
  { num: 29, code: 'f91', productName: 'БОО Яндекс Реклама квиз' },
  { num: 30, code: 'f92', productName: 'ДБО Яндекс Реклама квиз' },
  { num: 31, code: 'f93', productName: 'СВС Яндекс Реклама квиз БОО' },
];

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

async function main() {
  const res = await fetch(`${BASE}/api/funnels`, { headers: { Authorization: AUTH } });
  if (!res.ok) {
    console.error(`GET /api/funnels → HTTP ${res.status}`);
    process.exit(1);
  }
  const list = await res.json();
  const byNum = new Map(list.map((f) => [f.num, f]));
  console.log(`Прод: ${list.length} воронок.\n`);

  let planned = 0;
  let problems = 0;

  for (const t of TARGETS) {
    const f = byNum.get(t.num);
    if (!f) {
      console.error(`  ! num=${t.num} на проде не найдена`);
      problems++;
      continue;
    }
    const current = (f.frontCode || '').trim();
    if (current === t.code) {
      console.log(`  = num=${t.num}: код уже ${t.code}`);
      continue;
    }
    if (current !== '') {
      console.error(`  ! num=${t.num}: код уже «${current}» — пропускаю`);
      problems++;
      continue;
    }
    if ((f.productName || '').trim() !== t.productName) {
      console.error(`  ! num=${t.num}: продукт «${f.productName}» вместо «${t.productName}» — пропускаю`);
      problems++;
      continue;
    }
    if (dryRun) {
      console.log(`  - num=${t.num} (id=${f.id}): «—» → «${t.code}»`);
      planned++;
      continue;
    }
    const patch = await fetch(`${BASE}/api/funnels/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: AUTH },
      body: JSON.stringify({ frontCode: t.code }),
    });
    if (patch.ok) {
      console.log(`  - num=${t.num}: код ${t.code} проставлен (HTTP ${patch.status})`);
      planned++;
    } else {
      console.error(`  ! num=${t.num}: HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}`);
      problems++;
    }
  }

  console.log(`\nИтого: ${planned} ${dryRun ? 'к правке' : 'правок'}, ${problems} проблем.`);
  process.exit(problems > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
