import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { tagTemplates } from '../db/schema';
import { SCENARIOS, type Scenario, type TemplateMap } from './ab-tags';

/** Whole global template grouped by scenario, ordered by position. */
export function listTemplate(db: AnyDB): TemplateMap {
  const rows = db
    .select({ scenario: tagTemplates.scenario, name: tagTemplates.name })
    .from(tagTemplates)
    .orderBy(asc(tagTemplates.scenario), asc(tagTemplates.position))
    .all() as { scenario: Scenario; name: string }[];

  const out = { reg: [], time_15: [], time_19: [], messenger: [] } as TemplateMap;
  for (const r of rows) out[r.scenario].push(r.name);
  return out;
}

/**
 * Replace the entire ordered list of static tags for one scenario.
 * Deletes existing rows for the scenario and re-inserts by array order.
 * Must be self-contained (wraps its own transaction).
 */
export function replaceTemplateScenario(db: AnyDB, scenario: Scenario, names: string[]): void {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Invalid scenario "${scenario}"`);
  db.transaction((tx) => {
    tx.delete(tagTemplates).where(eq(tagTemplates.scenario, scenario)).run();
    names.forEach((name, position) => {
      tx.insert(tagTemplates).values({ scenario, name, position }).run();
    });
  });
}
