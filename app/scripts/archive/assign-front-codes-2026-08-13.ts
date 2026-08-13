/**
 * F-коды семи АРХИВНЫМ воронкам, у которых кода не было (2026-08-13).
 *
 * ЦЕЛЬ — БАЗА РЕПОЗИТОРИЯ (`../ksamata_funnels.db`), НЕ ПРОД.
 * Прод правится отдельным скриптом assign-front-codes-prod-2026-08-13.cjs:
 * это разные базы, и прогон здесь до людей в админке не доезжает.
 *
 *   num  продукт                      код
 *    10  СВС НИМБ РСЯ                 f87
 *    14  ЖКТ NR МП                    f88
 *    17  ДБО FAQ MAX                  f89
 *    18  ДБО HT ВК                    f90
 *    29  БОО Яндекс Реклама квиз      f91
 *    30  ДБО Яндекс Реклама квиз      f92
 *    31  СВС Яндекс Реклама квиз БОО  f93
 *
 * ПОЧЕМУ С f87. Максимум по обеим системам — f86 (замер 2026-08-12: в ЛИК 62
 * воронки, выше f86 ничего). Дыры в нумерации (f1–f5, f10, f14, f17, f18, f20,
 * f44, f49, f65, f71, f72, f75, f76, f77) НЕ занимаются: это чужие номера,
 * ЛИК может выдать их в любой момент. То же правило зашито в `nextFrontCode`.
 *
 * ЧЕГО НЕ ДЕЛАТЬ. У четырёх воронок `num` равен 10, 14, 17, 18 — и ровно эти
 * номера стоят в дырах. Совпадение не правило: у оставшихся трёх (num 29, 30,
 * 31) коды f29, f30, f31 заняты живыми воронками. Вывод кода из `num` — та
 * самая ошибка, из-за которой поиск по f70 возвращал две разные воронки.
 *
 * ПОЧЕМУ АРХИВНЫМ. Решение владельца 2026-08-12: адрес карточки становится
 * F-кодом, и семь бескодовых иначе остались бы на числовом адресе. Это
 * отменяет довод скрипта от 2026-07-28 («архивные в ЛИК не заводим, код им не
 * нужен») — теперь заводим, код нужен всем.
 *
 * Защита: несовпавший product_name — пропуск; занятый код — пропуск;
 * непустой текущий код — пропуск. Идемпотентно.
 *
 * Запуск из app/ (сначала --dry-run):
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-08-13.ts --dry-run
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/assign-front-codes-2026-08-13.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnels } from '../src/db/schema';
import { updateFunnel } from '../src/lib/funnels';

const TARGETS: { num: number; code: string; productName: string }[] = [
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

let planned = 0;
let problems = 0;

for (const t of TARGETS) {
  const row = db
    .select({ id: funnels.id, code: funnels.frontCode, productName: funnels.productName })
    .from(funnels)
    .where(eq(funnels.num, t.num))
    .get();

  if (!row) {
    console.error(`  ! num=${t.num} не найдена`);
    problems++;
    continue;
  }

  const current = (row.code ?? '').trim();
  const taken = db
    .select({ num: funnels.num })
    .from(funnels)
    .where(eq(funnels.frontCode, t.code))
    .get();

  if (current === t.code) {
    console.log(`  = num=${t.num}: код уже ${t.code}`);
  } else if (current !== '') {
    console.error(`  ! num=${t.num}: код уже «${current}», ожидался пустой — пропускаю`);
    problems++;
  } else if ((row.productName ?? '').trim() !== t.productName) {
    console.error(`  ! num=${t.num}: продукт «${row.productName}» вместо «${t.productName}» — пропускаю`);
    problems++;
  } else if (taken) {
    console.error(`  ! код ${t.code} занят воронкой num=${taken.num} — пропускаю`);
    problems++;
  } else if (dryRun) {
    console.log(`  - num=${t.num}: «—» → «${t.code}»  (${t.productName})`);
    planned++;
  } else {
    updateFunnel(db, row.id, { frontCode: t.code });
    console.log(`  - num=${t.num}: код ${t.code} проставлен  (${t.productName})`);
    planned++;
  }
}

console.log(`\nИтого: ${planned} ${dryRun ? 'к правке' : 'правок'}, ${problems} проблем.`);
process.exit(problems > 0 ? 1 : 0);
