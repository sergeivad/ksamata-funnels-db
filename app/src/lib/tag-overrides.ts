import { eq, asc } from 'drizzle-orm';
import { type AnyDB } from '../db/client';
import { funnelTagOverrides } from '../db/schema';
import { SCENARIOS, isAxisTag, type Scenario, type OverrideMap } from './ab-tags';
import { ValidationError } from './errors';

function emptyOverrideMap(): OverrideMap {
  return {
    reg: { add: [], remove: [] },
    time_15: { add: [], remove: [] },
    time_19: { add: [], remove: [] },
    messenger: { add: [], remove: [] },
  };
}

/** All overrides for a funnel, grouped by scenario, add/remove ordered by position. */
export function listOverrides(db: AnyDB, funnelId: number): OverrideMap {
  const rows = db
    .select({
      tagType: funnelTagOverrides.tagType,
      name: funnelTagOverrides.name,
      op: funnelTagOverrides.op,
    })
    .from(funnelTagOverrides)
    .where(eq(funnelTagOverrides.funnelId, funnelId))
    .orderBy(asc(funnelTagOverrides.tagType), asc(funnelTagOverrides.position))
    .all() as { tagType: Scenario; name: string; op: 'add' | 'remove' }[];

  const out = emptyOverrideMap();
  for (const r of rows) {
    if (r.op === 'add') out[r.tagType].add.push(r.name);
    else out[r.tagType].remove.push(r.name);
  }
  return out;
}

/**
 * Replace ALL overrides for a funnel. Axis-tag removes are dropped defensively
 * (axes are identity — suppressing them would corrupt getAxesForFunnel).
 * Self-contained transaction.
 */
export function replaceOverrides(db: AnyDB, funnelId: number, overrides: OverrideMap): void {
  // Уникальный индекс — (funnel_id, tag_type, name), без op, поэтому add и
  // remove одного имени в одном сценарии физически не помещаются оба. Раньше
  // второй молча гасился onConflictDoNothing, и запрос «убрать тег» уходил в
  // никуда. Противоречие лучше назвать вслух, чем разрешить втихую.
  for (const scenario of SCENARIOS) {
    const ov = overrides[scenario] ?? { add: [], remove: [] };
    const inAdd = new Set(ov.add);
    const clash = ov.remove.filter((name) => inAdd.has(name));
    if (clash.length > 0) {
      throw new ValidationError(
        `Сценарий "${scenario}": ${clash.join(', ')} — тег указан разом в add и remove`
      );
    }
  }

  db.transaction((tx) => {
    tx.delete(funnelTagOverrides).where(eq(funnelTagOverrides.funnelId, funnelId)).run();
    for (const scenario of SCENARIOS) {
      const ov = overrides[scenario] ?? { add: [], remove: [] };
      ov.add.forEach((name, position) => {
        tx.insert(funnelTagOverrides)
          .values({ funnelId, tagType: scenario, name, op: 'add', position })
          .onConflictDoNothing()
          .run();
      });
      ov.remove
        .filter((name) => !isAxisTag(name))
        .forEach((name, position) => {
          tx.insert(funnelTagOverrides)
            .values({ funnelId, tagType: scenario, name, op: 'remove', position })
            .onConflictDoNothing()
            .run();
        });
    }
  });
}
