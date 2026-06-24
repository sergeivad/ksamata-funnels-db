import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import { listRefs, createRef } from '../src/lib/refs';

// __dirname = app/tests/ → go up 2 levels to repo root
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_refs_test_${Date.now()}.db`);

copyFileSync(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const testDb = drizzle(sqlite, { schema });

afterAll(() => sqlite.close());

describe('listRefs', () => {
  it('returns an array of {id, name} ordered by name for products', () => {
    const rows = listRefs(testDb, 'products');
    expect(Array.isArray(rows)).toBe(true);
    // All rows must have id and name
    for (const r of rows) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
    }
    // Ordered by name (case-sensitive alphabetical)
    const names = rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('works for contractors, sources, tags', () => {
    for (const kind of ['contractors', 'sources', 'tags'] as const) {
      const rows = listRefs(testDb, kind);
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  it('throws on invalid kind', () => {
    expect(() => listRefs(testDb, 'bogus')).toThrow();
  });
});

describe('createRef', () => {
  it('POST new product ТКМ_TEST → appears in GET', () => {
    const created = createRef(testDb, 'products', 'ТКМ_TEST');
    expect(created).toHaveProperty('id');
    expect(created.name).toBe('ТКМ_TEST');

    const list = listRefs(testDb, 'products');
    const found = list.find((r) => r.name === 'ТКМ_TEST');
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
  });

  it('POST ТКМ_TEST again → no duplicate (same id, count unchanged)', () => {
    const first  = createRef(testDb, 'products', 'ТКМ_TEST');
    const second = createRef(testDb, 'products', 'ТКМ_TEST');
    expect(second.id).toBe(first.id);

    const list = listRefs(testDb, 'products');
    const matches = list.filter((r) => r.name === 'ТКМ_TEST');
    expect(matches.length).toBe(1);
  });

  it('throws on invalid kind bogus', () => {
    expect(() => createRef(testDb, 'bogus', 'whatever')).toThrow();
  });

  it('works for contractors, sources, tags', () => {
    const c = createRef(testDb, 'contractors', 'TestContractor_XYZ');
    expect(c.name).toBe('TestContractor_XYZ');

    const s = createRef(testDb, 'sources', 'TestSource_XYZ');
    expect(s.name).toBe('TestSource_XYZ');

    const t = createRef(testDb, 'tags', 'TestTag_XYZ');
    expect(t.name).toBe('TestTag_XYZ');
  });
});
