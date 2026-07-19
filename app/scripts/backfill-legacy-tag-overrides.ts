/**
 * One-time backfill: convert legacy non-AV `funnel_tags` rows into
 * `funnel_tag_overrides` `add` rows so they survive the Phase-5 wipe-all
 * materialization (see lib/funnels.ts materializeFunnelTags). Idempotent,
 * marker-gated. Run AFTER runMigratePhase5 (needs the seeded template).
 *
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/backfill-legacy-tag-overrides.ts
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { funnels, funnelTags, funnelTagOverrides, tags } from '../src/db/schema';
import { listTemplate } from '../src/lib/tag-templates';
import { axisTagNames, tagNamesToAxes, type Scenario } from '../src/lib/ab-tags';

export function backfillLegacyTagOverrides(sqlite: import('better-sqlite3').Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)`);
  const done = sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE name='phase5_legacy_overrides_backfill'`).get();
  if (done) return;

  const db = drizzle(sqlite, { schema });
  const template = listTemplate(db);
  const funnelRows = db.select({ id: funnels.id }).from(funnels).all() as { id: number }[];

  const tx = sqlite.transaction(() => {
    for (const { id } of funnelRows) {
      const rows = db
        .select({ tagType: funnelTags.tagType, name: tags.name, position: funnelTags.position })
        .from(funnelTags)
        .innerJoin(tags, eq(funnelTags.tagId, tags.id))
        .where(eq(funnelTags.funnelId, id))
        .all() as { tagType: Scenario; name: string; position: number }[];

      // Axes reconstructed from reg tags → the axis tags the default set will regenerate.
      const regNames = rows.filter((r) => r.tagType === 'reg').map((r) => r.name);
      const axisSet = new Set(axisTagNames(tagNamesToAxes(regNames)));

      const posByType: Record<Scenario, number> = { reg: 0, time_15: 0, time_19: 0, messenger: 0 };

      for (const r of rows) {
        // A tag the default set regenerates (template static OR axis tag) is NOT legacy — skip.
        const isDefault = (template[r.tagType] ?? []).includes(r.name) || axisSet.has(r.name);
        if (isDefault) continue;
        db.insert(funnelTagOverrides)
          .values({ funnelId: id, tagType: r.tagType, name: r.name, op: 'add', position: posByType[r.tagType]++ })
          .onConflictDoNothing()
          .run();
      }
    }
    sqlite.prepare(`INSERT INTO schema_migrations (name) VALUES ('phase5_legacy_overrides_backfill')`).run();
  });
  tx();
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Legacy tag-override backfill on: ${dbPath}`);
  backfillLegacyTagOverrides(sqlite);
  sqlite.close();
  console.log('Legacy tag-override backfill done.');
}
