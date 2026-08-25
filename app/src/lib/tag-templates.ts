import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { tagTemplates, funnelTypes } from '../db/schema';
import { SCENARIOS, type Scenario, type TemplateMap } from './ab-tags';
import { ValidationError } from './errors';

/** Whole global template grouped by scenario, ordered by position. */
export function listTemplate(db: AnyDB): TemplateMap {
  const rows = db
    .select({ scenario: tagTemplates.scenario, name: tagTemplates.name })
    .from(tagTemplates)
    .orderBy(asc(tagTemplates.scenario), asc(tagTemplates.position))
    .all() as { scenario: Scenario; name: string }[];

  const out = { reg: [], time_15: [], time_19: [], messenger: [], predspisok: [] } as TemplateMap;
  for (const r of rows) out[r.scenario].push(r.name);
  return out;
}

/**
 * Отклоняет любое имя из `names`, совпадающее со строкой в справочнике
 * `funnel_types`. Общая проверка для двух писателей маркера в обход
 * пятой оси:
 *  - `replaceTemplateScenario` (шаблон tag_templates);
 *  - `applyTagOverrides` в `funnels.ts` (per-funnel add-оверрайд).
 *
 * Маркер принадлежит справочнику типов, а не шаблону и не оверрайдам: набор
 * типов расширяемый и лежит в БД, поэтому проверка здесь, а не в
 * customTagNameSchema (Zod, validation.ts) — та чистая функция и знает
 * только четыре статичные оси, до БД у неё доступа нет.
 *
 * Если этот тег всё же попадёт в шаблон, следующее переименование типа через
 * /api/refs/funnel_types/[id] переименует чужой (шаблонный) тег — находка
 * рецензии задачи 2. В оверрайде эффект другой, но не менее вредный: имя
 * идентичности гасится движком (computeTagSet/isIdentity в ab-tags.ts) на
 * материализации, так что строка в funnel_tag_overrides молча не делает
 * ничего — ни ошибки, ни эффекта, не отличить от опечатки без чтения кода.
 */
export function assertNotFunnelTypeMarker(db: AnyDB, names: string[]): void {
  const known = new Set(
    (db.select({ name: funnelTypes.name }).from(funnelTypes).all() as { name: string }[])
      .map((r) => r.name),
  );
  for (const name of names) {
    if (known.has(name)) {
      throw new ValidationError(
        `«${name}» — маркер типа воронки, он выводится из типа и в шаблоне не хранится`,
      );
    }
  }
}

/**
 * Replace the entire ordered list of static tags for one scenario.
 * Deletes existing rows for the scenario and re-inserts by array order.
 * Must be self-contained (wraps its own transaction).
 */
export function replaceTemplateScenario(db: AnyDB, scenario: Scenario, names: string[]): void {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Invalid scenario "${scenario}"`);

  assertNotFunnelTypeMarker(db, names);

  db.transaction((tx) => {
    tx.delete(tagTemplates).where(eq(tagTemplates.scenario, scenario)).run();
    names.forEach((name, position) => {
      tx.insert(tagTemplates).values({ scenario, name, position }).run();
    });
  });
}
