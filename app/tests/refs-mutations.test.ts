/**
 * lib/refs.ts mutation tests — rename/delete a reference value, and how that
 * ripples through funnel_tags (АВ tags) + the live-derived funnel name.
 *
 * ISOLATION: operates on a TEMP COPY of the DB. The real ksamata_funnels.db
 * is never opened directly.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { createRef, getRefUsage, renameRef, deleteRef, type RefRow } from '../src/lib/refs';
import { createFunnel, listFunnels, getFunnel } from '../src/lib/funnels';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { runMigrateMessengerTagType } from '../scripts/migrate-messenger-tagtype';
import { runMigratePhase5 } from '../scripts/migrate-phase5';

const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB = join(tmpdir(), `ksamata_refs_mutations_test_${Date.now()}_${process.pid}.db`);

copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase3(sqlite);
runMigrateMessengerTagType(sqlite);
runMigratePhase5(sqlite);
const testDb = drizzle(sqlite, { schema });

afterAll(() => {
  sqlite.close();
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
});

let numCounter = 9800;
function nextNum(): number {
  numCounter += 1;
  return numCounter;
}

function makeFunnel(overrides: Partial<Parameters<typeof createFunnel>[1]> = {}) {
  return createFunnel(testDb, {
    num: nextNum(),
    frontCode: '',
    status: 'active',
    productName: 'Тест продукт',
    variant: 'А',
    landingUrl: '',
    startDate: '',
    blockName: '',
    product: 'RefMutProduct',
    contractor: 'RefMutContractor',
    channel: 'RefMutChannel',
    direction: 'RefMutDirection',
    sourceName: 'RefMutSource',
    ...overrides,
  });
}

// ─── getRefUsage ──────────────────────────────────────────────────────────────

describe('getRefUsage', () => {
  it('reports 0 for a freshly created, unused product', () => {
    const row = createRef(testDb, 'products', `UnusedProduct_${Date.now()}`);
    const usage = getRefUsage(testDb, 'products', row);
    expect(usage.count).toBe(0);
    expect(usage.funnelIds).toEqual([]);
  });

  it('reports the funnel that uses a product (FK + АВ tag agree)', () => {
    const productName = `UsedProduct_${Date.now()}`;
    const funnel = makeFunnel({ product: productName });

    const row = createRef(testDb, 'products', productName); // get-or-create → existing row
    const usage = getRefUsage(testDb, 'products', row);
    expect(usage.count).toBe(1);
    expect(usage.funnelIds).toContain(funnel.id);
  });

  it('counts a channel via its АВ tag even though channels have no FK column', () => {
    const channelName = `UsedChannel_${Date.now()}`;
    const funnel = makeFunnel({ channel: channelName });

    const row = createRef(testDb, 'channels', channelName);
    const usage = getRefUsage(testDb, 'channels', row);
    expect(usage.count).toBe(1);
    expect(usage.funnelIds).toContain(funnel.id);
  });
});

// ─── renameRef ────────────────────────────────────────────────────────────────

describe('renameRef', () => {
  it('renames an unused product with no side effects', () => {
    const original = createRef(testDb, 'products', `RenameUnused_${Date.now()}`);
    const newName = `RenameUnused_${Date.now()}_new`;

    const result = renameRef(testDb, 'products', original.id, newName);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.name).toBe(newName);
      expect(result.row.id).toBe(original.id);
    }
  });

  it('renames a used product AND updates its АВ tag + the derived funnel name', () => {
    const oldProductName = `RenameUsedProduct_${Date.now()}`;
    const newProductName = `TotallyDifferentName_${Date.now()}`;
    const funnel = makeFunnel({ product: oldProductName, contractor: 'RenameCtrX' });

    const beforeAxes = getFunnel(testDb, funnel.id)!.axes;
    expect(beforeAxes.product).toBe(oldProductName);

    const row = createRef(testDb, 'products', oldProductName);
    const result = renameRef(testDb, 'products', row.id, newProductName);
    expect(result.ok).toBe(true);

    const afterFunnel = getFunnel(testDb, funnel.id)!;
    expect(afterFunnel.axes.product).toBe(newProductName);
    expect(afterFunnel.name).toContain(newProductName);
    expect(afterFunnel.name).not.toContain(oldProductName);

    // GET /api/funnels equivalent (listFunnels) picks up the new name too.
    const listed = listFunnels(testDb).find((f) => f.id === funnel.id)!;
    expect(listed.name).toContain(newProductName);

    // The old АВ tag text is gone; only the new one remains for this funnel.
    const tagRows = sqlite
      .prepare(
        `SELECT t.name FROM funnel_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.funnel_id = ?`
      )
      .all(funnel.id) as { name: string }[];
    const names = tagRows.map((r) => r.name);
    expect(names).toContain(`АВ Продукт: ${newProductName}`);
    expect(names).not.toContain(`АВ Продукт: ${oldProductName}`);
  });

  it('renaming a channel used by a funnel updates the derived name too', () => {
    const oldChannel = `RenameUsedChannel_${Date.now()}`;
    const newChannel = `${oldChannel}_renamed`;
    const funnel = makeFunnel({ channel: oldChannel });

    const row = createRef(testDb, 'channels', oldChannel);
    const result = renameRef(testDb, 'channels', row.id, newChannel);
    expect(result.ok).toBe(true);

    const afterFunnel = getFunnel(testDb, funnel.id)!;
    expect(afterFunnel.axes.channel).toBe(newChannel);
  });

  it('rename to an already-existing name in the same table → duplicate error', () => {
    const a = createRef(testDb, 'products', `DupA_${Date.now()}`);
    const b = createRef(testDb, 'products', `DupB_${Date.now()}`);

    const result = renameRef(testDb, 'products', a.id, b.name);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('duplicate');

    // Unaffected — original name still intact
    const rawA = sqlite.prepare('SELECT name FROM products WHERE id = ?').get(a.id) as { name: string };
    expect(rawA.name).toBe(a.name);
  });

  it('rename of a non-existent id → not_found', () => {
    const result = renameRef(testDb, 'products', 999_999_999, 'whatever');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not_found');
  });

  it('merges into a pre-existing orphan АВ tag (data-drift case: tag text survives after its ref row was reconciled away)', () => {
    // Simulates the exact scenario mentioned in the contractor-reconciliation
    // history: a stale "АВ Подрядчик: <nameY>" tag is still attached to
    // funnelY's funnel_tags, but there is no LIVE contractors row named
    // nameY any more (it was merged/deleted directly at the DB level,
    // bypassing deleteRef). renameRef must still merge onto that tag instead
    // of silently orphaning funnelX's new text.
    const nameX = `MergeX_${Date.now()}`;
    const nameY = `MergeY_${Date.now()}`;
    const funnelX = makeFunnel({ contractor: nameX });
    const funnelY = makeFunnel({ contractor: nameY });

    // Drop the live contractors row for nameY directly (data drift), leaving
    // its "АВ Подрядчик: nameY" tag + funnel_tags row on funnelY intact.
    // funnelY.contractor_id must be repointed first — it's a NOT NULL FK —
    // mirroring a real reconciliation that dedupes the contractors table
    // without touching the (FK-independent) AV tag text already on disk.
    const placeholder = createRef(testDb, 'contractors', `MergePlaceholder_${Date.now()}`);
    sqlite.prepare('UPDATE funnels SET contractor_id = ? WHERE id = ?').run(placeholder.id, funnelY.id);
    sqlite.prepare('DELETE FROM contractors WHERE name = ?').run(nameY);
    expect(sqlite.prepare('SELECT id FROM contractors WHERE name = ?').get(nameY)).toBeUndefined();
    expect(sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(`АВ Подрядчик: ${nameY}`)).toBeDefined();

    const rowX = createRef(testDb, 'contractors', nameX);
    const result = renameRef(testDb, 'contractors', rowX.id, nameY);
    expect(result.ok).toBe(true);

    // Both funnels now read back contractor = nameY, via the SAME merged tag id.
    expect(getFunnel(testDb, funnelX.id)!.axes.contractor).toBe(nameY);
    expect(getFunnel(testDb, funnelY.id)!.axes.contractor).toBe(nameY);

    const tagRow = sqlite
      .prepare('SELECT id FROM tags WHERE name = ?')
      .get(`АВ Подрядчик: ${nameY}`) as { id: number } | undefined;
    expect(tagRow).toBeDefined();

    const oldTagRow = sqlite
      .prepare('SELECT id FROM tags WHERE name = ?')
      .get(`АВ Подрядчик: ${nameX}`) as { id: number } | undefined;
    expect(oldTagRow).toBeUndefined();
  });
});

// ─── deleteRef ────────────────────────────────────────────────────────────────

describe('deleteRef', () => {
  it('deletes an unused product', () => {
    const row = createRef(testDb, 'products', `DeleteUnused_${Date.now()}`);
    const result = deleteRef(testDb, 'products', row.id);
    expect(result.ok).toBe(true);

    const raw = sqlite.prepare('SELECT id FROM products WHERE id = ?').get(row.id);
    expect(raw).toBeUndefined();
  });

  it('refuses to delete a product used by a funnel → in_use with usedBy count', () => {
    const productName = `DeleteUsedProduct_${Date.now()}`;
    makeFunnel({ product: productName });
    const row = createRef(testDb, 'products', productName);

    const result = deleteRef(testDb, 'products', row.id);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === 'in_use') {
      expect(result.usedBy).toBe(1);
    } else {
      throw new Error('expected in_use error');
    }

    // Row must still exist
    const raw = sqlite.prepare('SELECT id FROM products WHERE id = ?').get(row.id);
    expect(raw).toBeDefined();
  });

  it('refuses to delete a channel used only via АВ tag (no FK column)', () => {
    const channelName = `DeleteUsedChannel_${Date.now()}`;
    makeFunnel({ channel: channelName });
    const row = createRef(testDb, 'channels', channelName);

    const result = deleteRef(testDb, 'channels', row.id);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === 'in_use') {
      expect(result.usedBy).toBe(1);
    } else {
      throw new Error('expected in_use error');
    }
  });

  it('delete of a non-existent id → not_found', () => {
    const result = deleteRef(testDb, 'products', 999_999_999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not_found');
  });
});

// Sanity: exported RefRow type shape used above compiles fine.
const _typeCheck: RefRow = { id: 1, name: 'x' };
void _typeCheck;
