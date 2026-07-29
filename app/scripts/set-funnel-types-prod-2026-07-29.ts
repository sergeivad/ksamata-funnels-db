/**
 * Пятая ось на проде: та же правка, что set-funnel-types-2026-07-28.ts сделал
 * локально, но через публичный API — прод правится только так (см. CLAUDE.md).
 *
 * Схему на проде накатывает docker-entrypoint.sh при старте контейнера
 * (фаза 8: справочник funnel_types + funnels.funnel_type_id + бэкфилл
 * «АВ Автоворонка» всем). Этот скрипт доделывает то, чего миграция не знает:
 *
 *   1. Убирает маркер из шаблона тегов — четыре сценария, PUT /api/tag-templates.
 *      До этого шага прод внешне работает правильно (маркер идёт из типа, а
 *      шаблонный гасится слоем идентичности), но страница /tags не сохраняется:
 *      редактор отправляет весь список имён вместе с маркером, а новый код
 *      отвечает на маркер в шаблоне 400. Это единственная видимая поломка.
 *   2. Проставляет двенадцати воронкам их настоящий тип — PATCH /api/funnels/[id].
 *
 * Порядок обязателен и он тот же, что локально: сначала шаблон, потом типы.
 * Бэкфилл фазы 8 уже дал каждой воронке «АВ Автоворонка», поэтому чистка
 * шаблона ничего не теряет; в обратном порядке воронки на время остались бы
 * без маркера вовсе.
 *
 * ИСТОЧНИК ПРАВДЫ — ЛОКАЛЬНАЯ БАЗА, а не зашитый список. Она уже выверена
 * (60 / 11 / 1 / 0) и прошла проводник axesMismatch, так что дублировать
 * двенадцать строк здесь значило бы завести второе место, где их можно
 * рассинхронизировать. Скрипт читает локальную базу, сравнивает с продом и
 * правит только расхождения.
 *
 * СВЯЗЬ ПО num, НЕ ПО id И НЕ ПО F-КОДУ. id у прода и локальной базы свои и
 * совпадать не обязаны; F-коды в июле переставляли (см. front-code.ts), и
 * связывать по подвижному номеру — как раз способ попасть не в ту воронку.
 * `num` — внутренний ключ, он не меняется.
 *
 * ЗАЩИТА ПО ОСЯМ. Даже совпав по num, воронка проверяется на совпадение всех
 * четырёх осей с локальной. Не совпало — правка пропускается с сообщением, а
 * не применяется «на всякий случай»: перепутать воронку при смене типа так же
 * неприятно, как при смене статуса.
 *
 * Идемпотентен: уже очищенный сценарий и уже проставленный тип пропускаются
 * с «=». Повторный прогон безопасен.
 *
 * Запуск из app/ (сначала обязательно с --dry-run — он только читает):
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/set-funnel-types-prod-2026-07-29.ts --dry-run
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/set-funnel-types-prod-2026-07-29.ts --apply
 */
import { db } from '../src/db/client';
import { listFunnels } from '../src/lib/funnels';
import { listTemplate } from '../src/lib/tag-templates';
import { listRefs } from '../src/lib/refs';
import { SCENARIOS, type Scenario } from '../src/lib/ab-tags';
import { FUNNEL_TYPE_KIND } from '../src/lib/funnel-type';

const PROD = process.env.PROD_BASE_URL ?? 'https://funnels.ksamata.ru';

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
if (apply === dryRun) {
  console.error('Укажи ровно один режим: --dry-run или --apply');
  process.exit(2);
}

type ProdFunnel = {
  id: number;
  num: number;
  frontCode: string;
  funnelType: string | null;
  axes: { product: string; contractor: string; channel: string; direction: string };
};

const AXES = ['product', 'contractor', 'channel', 'direction'] as const;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PROD}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  // Маркеры берём из справочника прода, а не из локального: чистить шаблон
  // надо от того, что маркером считает ИМЕННО прод. Разойдись справочники —
  // лучше увидеть это здесь, чем оставить в шаблоне строку, которую прод
  // считает маркером и из-за которой /tags продолжит отвечать 400.
  const prodTypes = await getJson<{ id: number; name: string }[]>(`/api/refs/${FUNNEL_TYPE_KIND}`);
  const markers = new Set(prodTypes.map((t) => t.name));
  const localTypes = listRefs(db, FUNNEL_TYPE_KIND).map((r) => r.name);
  const onlyLocal = localTypes.filter((n) => !markers.has(n));
  if (onlyLocal.length > 0) {
    console.log(`⚠ в локальном справочнике есть типы, которых нет на проде: ${onlyLocal.join(', ')}`);
  }

  const prodTemplate = await getJson<Record<Scenario, string[]>>('/api/tag-templates');
  const prodFunnels = await getJson<ProdFunnel[]>('/api/funnels');
  const prodByNum = new Map(prodFunnels.map((f) => [f.num, f]));
  const localFunnels = listFunnels(db);
  console.log(`Прод: ${prodFunnels.length} воронок. Локально: ${localFunnels.length}.\n`);

  // ── Шаг 1: маркер вон из шаблона ────────────────────────────────────────
  let templateChanged = 0;
  for (const scenario of SCENARIOS) {
    const current = prodTemplate[scenario] ?? [];
    const cleaned = current.filter((n) => !markers.has(n));
    if (cleaned.length === current.length) {
      console.log(`  = шаблон ${scenario}: маркера нет`);
      continue;
    }
    const removed = current.filter((n) => markers.has(n));
    if (dryRun) {
      console.log(`  - шаблон ${scenario}: убрать ${removed.join(', ')}`);
      templateChanged += 1;
      continue;
    }
    const res = await fetch(`${PROD}/api/tag-templates/${scenario}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: cleaned }),
    });
    if (res.ok) {
      console.log(`  ✓ шаблон ${scenario} очищен (убрано: ${removed.join(', ')})`);
      templateChanged += 1;
    } else {
      console.log(`  ! шаблон ${scenario}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }
  // Сверять локальный шаблон с продовым построчно намеренно не будем: у прода
  // могут быть свои легаси-строки (например «автоворонки» в time_15), и задача
  // этого скрипта — убрать маркер, а не выровнять шаблоны целиком.
  const localTemplate = listTemplate(db);
  for (const scenario of SCENARIOS) {
    const want = (localTemplate[scenario] ?? []).join(' | ');
    const got = (prodTemplate[scenario] ?? []).filter((n) => !markers.has(n)).join(' | ');
    if (want !== got) console.log(`    (шаблон ${scenario} и без маркера отличается от локального: «${got}» против «${want}»)`);
  }

  // ── Шаг 2: двенадцать типов ─────────────────────────────────────────────
  console.log('');
  let typed = 0;
  let skipped = 0;
  for (const local of localFunnels) {
    const onProd = prodByNum.get(local.num);
    if (!onProd) {
      console.log(`  ! num=${local.num} (${local.frontCode}) на проде нет — пропуск`);
      skipped += 1;
      continue;
    }
    if (onProd.funnelType === local.funnelType) continue;

    const mismatch = AXES
      .filter((axis) => onProd.axes[axis] !== local.axes[axis])
      .map((axis) => `${axis}: прод «${onProd.axes[axis] || '—'}» ≠ локально «${local.axes[axis] || '—'}»`);
    if (mismatch.length > 0) {
      console.log(`  ! num=${local.num} (${local.frontCode}) оси разошлись, тип НЕ меняем: ${mismatch.join('; ')}`);
      skipped += 1;
      continue;
    }

    const label = `num=${local.num} ${local.frontCode}: «${onProd.funnelType ?? '—'}» → «${local.funnelType ?? '—'}»`;
    if (dryRun) {
      console.log(`  - ${label}`);
      typed += 1;
      continue;
    }
    const res = await fetch(`${PROD}/api/funnels/${onProd.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ funnelType: local.funnelType ?? '' }),
    });
    if (res.ok) {
      console.log(`  ✓ ${label}`);
      typed += 1;
    } else {
      console.log(`  ! ${label} — HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      skipped += 1;
    }
  }

  // ── Сводка ──────────────────────────────────────────────────────────────
  console.log(`\n${dryRun ? 'Будет изменено' : 'Изменено'}: сценариев шаблона ${templateChanged}, типов ${typed}.`
    + (skipped ? ` Пропущено: ${skipped}.` : ''));

  const after = dryRun ? prodFunnels : await getJson<ProdFunnel[]>('/api/funnels');
  const counts = new Map<string, number>();
  for (const f of after) {
    const key = f.funnelType ?? '(тип не выбран)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`\nИтог по маркерам на проде${dryRun ? ' (СЕЙЧАС, до правок)' : ''}:`);
  for (const name of [...prodTypes.map((t) => t.name), '(тип не выбран)']) {
    if (counts.has(name)) console.log(`  ${name}: ${counts.get(name)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
