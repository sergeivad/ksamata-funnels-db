import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigratePhase3 } from '../scripts/migrate-phase3';
import { getBlock, listBlocks, replaceBlock } from '../src/lib/funnel-blocks';
import * as schema from '../src/db/schema';

const REAL_DB = path.resolve(process.cwd(), '..', 'ksamata_funnels.db');
let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let funnelId: number;

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `fb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.copyFileSync(REAL_DB, tmp);
  sqlite = new Database(tmp);
  runMigratePhase3(sqlite);
  db = drizzle(sqlite, { schema });
  funnelId = (sqlite.prepare('SELECT id FROM funnels LIMIT 1').get() as { id: number }).id;
  sqlite.prepare('DELETE FROM funnel_block_items WHERE block_id IN (SELECT id FROM funnel_blocks WHERE funnel_id = ?)').run(funnelId);
  sqlite.prepare('DELETE FROM funnel_blocks WHERE funnel_id = ?').run(funnelId);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmp, { force: true });
});

describe('funnel-blocks', () => {
  it('listBlocks returns all 9 kinds with catalog defaults when empty', () => {
    const blocks = listBlocks(db, funnelId);
    expect(blocks).toHaveLength(9);
    const landings = blocks.find((b) => b.kind === 'landings')!;
    expect(landings.enabled).toBe(true);   // default enabled
    expect(landings.items).toEqual([]);
    const oto = blocks.find((b) => b.kind === 'oto')!;
    expect(oto.enabled).toBe(false);
  });

  it('replaceBlock upserts config and items, getBlock reads them back', () => {
    replaceBlock(db, funnelId, 'tariffs', true, 'by_time', [
      { slot: '15', label: '', url: 'https://a' },
      { slot: '19', label: '', url: 'https://b' },
    ]);
    const b = getBlock(db, funnelId, 'tariffs');
    expect(b.enabled).toBe(true);
    expect(b.mode).toBe('by_time');
    expect(b.items).toEqual([
      { slot: '15', label: '', url: 'https://a' },
      { slot: '19', label: '', url: 'https://b' },
    ]);
  });

  it('replaceBlock replaces (does not append) on second call', () => {
    replaceBlock(db, funnelId, 'bonuses', true, 'common', [{ slot: null, label: '', url: 'https://x' }]);
    replaceBlock(db, funnelId, 'bonuses', true, 'common', [{ slot: null, label: '', url: 'https://y' }]);
    expect(getBlock(db, funnelId, 'bonuses').items).toEqual([{ slot: null, label: '', url: 'https://y' }]);
  });

  it('replaceBlock can disable a block and clear items', () => {
    replaceBlock(db, funnelId, 'oto', true, 'common', [{ slot: null, label: '', url: 'https://x' }]);
    replaceBlock(db, funnelId, 'oto', false, 'common', []);
    const b = getBlock(db, funnelId, 'oto');
    expect(b.enabled).toBe(false);
    expect(b.items).toEqual([]);
  });
});
