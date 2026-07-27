/**
 * Легаси-тег «автоворонки» убирается из шаблона у `reg` и `messenger`.
 * На оплатах (`time_15`, `time_19`) он ОСТАЁТСЯ.
 *
 * Решение владельца 2026-07-28: тег живой и нужен именно на оплатах — на нём
 * настроены дашборды внутри GetCourse и с ним исторически работает отдел
 * продаж. Реестр это подтверждает: из 2022 предложений этапа «Оплата» его
 * несут 2005. А вот на регистрациях (2 из 113) и мессенджерах (0 из 139) его
 * нет и не было — там стоит новый `АВ Автоворонка` (107 и 82 соответственно,
 * остальные несут маркеры пятой оси).
 *
 * То есть расхождение было не в GetCourse, а в шаблоне базы: он требовал
 * легаси-тег от всех четырёх сценариев. Отсюда крупнейшая строка отчёта —
 * класс 1, «база ожидает тег автоворонки на 72 парах», 733 712 заказов.
 *
 * Правка снимает 144 строки `funnel_tags` (72 воронки × 2 сценария) и НИЧЕГО
 * не меняет на оплатах. Оверрайдов с этим тегом нет ни у одной воронки —
 * он приходит только из шаблона, так что терять нечего.
 *
 * Шаблон и пересинк идут ОДНОЙ транзакцией, как в
 * `PUT /api/tag-templates/[scenario]`: шаблон сам по себе не является
 * валидным состоянием — если пересинк упадёт на полпути, воронки останутся
 * с материализацией по старому шаблону, и ничто не покажет расхождение.
 *
 * Идемпотентен: сценарий, где тега уже нет, пропускается.
 *
 * Запуск из app/ (сначала обязательно с --dry-run):
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/drop-legacy-autofunnel-from-reg-messenger-2026-07-28.ts --dry-run
 *   FUNNELS_DB_PATH=/abs/path/ksamata_funnels.db npx tsx scripts/drop-legacy-autofunnel-from-reg-messenger-2026-07-28.ts --apply
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { funnelTags, tags } from '../src/db/schema';
import type { Scenario } from '../src/lib/ab-tags';
import { listTemplate, replaceTemplateScenario } from '../src/lib/tag-templates';
import { resyncAllFunnels } from '../src/lib/funnels';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';
const LEGACY = 'автоворонки';
const TARGETS: Scenario[] = ['reg', 'messenger'];
/** Сценарии, где тег обязан остаться — проверяем это после правки. */
const KEEP: Scenario[] = ['time_15', 'time_19'];

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

/** Сколько строк funnel_tags несут легаси-тег, по сценариям. */
function materializedCounts(): Record<string, number> {
  const rows = db
    .select({ tagType: funnelTags.tagType })
    .from(funnelTags)
    .innerJoin(tags, eq(funnelTags.tagId, tags.id))
    .where(eq(tags.name, LEGACY))
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tagType] = (out[r.tagType] ?? 0) + 1;
  return out;
}

async function main() {
  const before = listTemplate(db);
  console.log('Шаблон сейчас:');
  for (const [scenario, names] of Object.entries(before)) {
    console.log(`  ${scenario.padEnd(10)} ${names.join(' | ')}`);
  }
  console.log('\nСтрок funnel_tags с легаси-тегом:', JSON.stringify(materializedCounts()));

  const toChange = TARGETS.filter((s) => (before[s] ?? []).includes(LEGACY));
  if (!toChange.length) {
    console.log(`\n= тега «${LEGACY}» в сценариях ${TARGETS.join(', ')} уже нет`);
  }

  for (const scenario of toChange) {
    const next = before[scenario].filter((n) => n !== LEGACY);
    if (dryRun) {
      console.log(`\n- ${scenario}: ${before[scenario].join(' | ')}`);
      console.log(`         → ${next.join(' | ')}`);
      continue;
    }
    db.transaction((tx) => {
      replaceTemplateScenario(tx, scenario, next);
      resyncAllFunnels(tx);
    });
    console.log(`\n- ${scenario} локально: ${next.join(' | ')}`);

    const res = await fetch(`${PROD}/api/tag-templates/${scenario}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: next }),
    });
    console.log(res.ok
      ? `  - ${scenario} на проде: HTTP ${res.status}`
      : `  ! ${scenario} прод ответил HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  if (!dryRun) {
    const after = listTemplate(db);
    const counts = materializedCounts();
    console.log('\nПосле правки:', JSON.stringify(counts));
    for (const s of KEEP) {
      if (!(after[s] ?? []).includes(LEGACY)) {
        console.error(`  ! ОШИБКА: тег пропал из «${s}», хотя должен был остаться`);
        process.exit(1);
      }
    }
    for (const s of TARGETS) {
      if (counts[s]) {
        console.error(`  ! ОШИБКА: в «${s}» осталось ${counts[s]} строк с легаси-тегом`);
        process.exit(1);
      }
    }
    console.log('  = на оплатах тег на месте, из reg/messenger убран');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
