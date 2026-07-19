import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { funnelTagOverrides } from '../src/db/schema';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';
import { backfillLegacyTagOverrides } from '../scripts/backfill-legacy-tag-overrides';
import { updateFunnel, getFunnel } from '../src/lib/funnels';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `bflo_${Date.now()}_${process.pid}.db`);
copyFileSync(REAL_DB, TMP_DB);
const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
// The real DB this fixture is copied from has already been through the
// legacy-overrides backfill in production (Task 12 bakes the marker into
// the committed ksamata_funnels.db). Clear it here so this test exercises
// a fresh first run regardless of the source DB's own migration state.
sqlite.prepare(`DELETE FROM schema_migrations WHERE name = 'phase5_legacy_overrides_backfill'`).run();
const db = drizzle(sqlite, { schema });

afterAll(() => { sqlite.close(); if (existsSync(TMP_DB)) unlinkSync(TMP_DB); });

// Pick a real funnel that carries a legacy non-AV, non-template tag.
// Seed a deterministic one so the test is not fixture-dependent:
const FID = (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT 1`).get() as { id: number }).id;
const LEGACY = 'ЛЕГАСИ-ТЕСТ-ТЕГ';

function attachLegacy() {
  const tagId = (sqlite.prepare(`INSERT INTO tags (name) VALUES (?) RETURNING id`).get(LEGACY) as { id: number }).id;
  sqlite.prepare(`INSERT INTO funnel_tags (funnel_id, tag_id, tag_type, position) VALUES (?, ?, 'reg', 99)`).run(FID, tagId);
}

describe('backfillLegacyTagOverrides', () => {
  it('converts a legacy non-AV/non-template tag into an override add, and materialize preserves it', () => {
    attachLegacy();

    backfillLegacyTagOverrides(sqlite);

    // The legacy tag is now recorded as an override 'add' for reg.
    const ovr = db.select().from(funnelTagOverrides)
      .where(and(eq(funnelTagOverrides.funnelId, FID), eq(funnelTagOverrides.name, LEGACY))).all();
    expect(ovr).toHaveLength(1);
    expect(ovr[0].op).toBe('add');
    expect(ovr[0].tagType).toBe('reg');

    // A template default (автоворонки) must NOT be backfilled as an override.
    const dflt = db.select().from(funnelTagOverrides)
      .where(and(eq(funnelTagOverrides.funnelId, FID), eq(funnelTagOverrides.name, 'автоворонки'))).all();
    expect(dflt).toHaveLength(0);

    // Re-materialize via the public updateFunnel path (axis unchanged) — legacy tag survives.
    const cur = getFunnel(db, FID)!;
    updateFunnel(db, FID, { product: cur.axes.product } as never);
    const names = getFunnel(db, FID)!.tagSets.reg.tags.map((t) => t.name);
    expect(names).toContain(LEGACY);
  });

  it('is idempotent (second run inserts nothing new, does not throw)', () => {
    const before = db.select().from(funnelTagOverrides).all().length;
    backfillLegacyTagOverrides(sqlite);
    const after = db.select().from(funnelTagOverrides).all().length;
    expect(after).toBe(before);
  });
});
