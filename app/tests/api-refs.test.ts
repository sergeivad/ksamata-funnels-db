import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../src/db/schema';
import {
  listRefs,
  createRef,
  isValidKind,
  isImmutableKind,
  refTagNameFor,
  getRefByName,
  deleteRef,
  renameRef,
} from '../src/lib/refs';
import { runMigratePhase7 } from '../scripts/migrate-phase7';
import { copyDbForTest } from './helpers/db';

// __dirname = app/tests/ → go up 2 levels to repo root
const REAL_DB = join(__dirname, '../../ksamata_funnels.db');
const TMP_DB  = join(tmpdir(), `ksamata_refs_test_${Date.now()}.db`);

copyDbForTest(REAL_DB, TMP_DB);

const sqlite = new Database(TMP_DB);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
runMigratePhase7(sqlite);
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

describe('channels', () => {
  it('listRefs(channels) returns seeded channel names', () => {
    const rows = listRefs(testDb, 'channels');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    const names = rows.map((r) => r.name);
    expect(names).toContain('Ютуб');
    expect(names).toContain('ВК');
  });

  it('createRef(channels, ТестКанал) adds and does not duplicate', () => {
    const first = createRef(testDb, 'channels', 'ТестКанал');
    expect(first).toHaveProperty('id');
    expect(first.name).toBe('ТестКанал');

    const second = createRef(testDb, 'channels', 'ТестКанал');
    expect(second.id).toBe(first.id);

    const list = listRefs(testDb, 'channels');
    const matches = list.filter((r) => r.name === 'ТестКанал');
    expect(matches.length).toBe(1);
  });
});

describe('directions', () => {
  it('listRefs(directions) is non-empty', () => {
    const rows = listRefs(testDb, 'directions');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
    }
  });
});

describe('справочник типов воронки', () => {
  it('funnel_types — валидный вид и он редактируемый', () => {
    expect(isValidKind('funnel_types')).toBe(true);
    expect(isImmutableKind('funnel_types')).toBe(false);
  });

  it('зеркальный тег типа — само значение, без префикса', () => {
    expect(refTagNameFor('funnel_types', 'АВ Квиз')).toBe('АВ Квиз');
    expect(refTagNameFor('directions', 'РСЯ')).toBe('АВ Направление: РСЯ');
    expect(refTagNameFor('sources', 'Яндекс НИМБ')).toBeNull();
  });

  it('используемый тип удалить нельзя', () => {
    const row = getRefByName(testDb, 'funnel_types', 'АВ Автоворонка')!;
    const res = deleteRef(testDb, 'funnel_types', row.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('in_use');
  });

  it('неиспользуемый тип удалить можно', () => {
    const created = createRef(testDb, 'funnel_types', 'АВ Тест-Маркер');
    const res = deleteRef(testDb, 'funnel_types', created.id);
    expect(res.ok).toBe(true);
  });

  it('переименование типа переносит зеркальный тег вместе со значением', () => {
    // Собственные имена, не «АВ Автоворонка» — переименование этого маркера
    // задело бы шаблонный тег (см. отчёт задачи 2) и отравило бы соседние
    // тесты файла, которые делят одну и ту же тестовую БД.
    const oldTypeName = 'АВ Тест-Маркер-Ренейм';
    const newTypeName = 'АВ Тест-Маркер-Ренейм-2';

    const typeRow = createRef(testDb, 'funnel_types', oldTypeName);

    // Сегодня никакой движок не заводит зеркальный тег для funnel_types сам
    // (в отличие от четырёх осей, где это на сохранении воронки делает
    // computeTagSet) — кладём его вручную, чтобы проверить именно проводку
    // refTagNameFor → renameOrMergeTag внутри renameRef, не дожидаясь
    // механики, которой ещё нет.
    const tagRow = testDb
      .insert(schema.tags)
      .values({ name: oldTypeName })
      .returning({ id: schema.tags.id, name: schema.tags.name })
      .get();

    const anyFunnel = testDb
      .select({ id: schema.funnels.id })
      .from(schema.funnels)
      .limit(1)
      .get() as { id: number };

    testDb
      .insert(schema.funnelTags)
      .values({ funnelId: anyFunnel.id, tagId: tagRow.id, tagType: 'reg', position: 0 })
      .run();

    const res = renameRef(testDb, 'funnel_types', typeRow.id, newTypeName);
    expect(res.ok).toBe(true);

    // Старое имя тега исчезло, новое — на месте того же id (тег
    // переименован in-place: renameOrMergeTag мержит только когда строка
    // с новым именем уже существует).
    expect(getRefByName(testDb, 'tags', oldTypeName)).toBeUndefined();
    const renamedTag = getRefByName(testDb, 'tags', newTypeName);
    expect(renamedTag).toBeDefined();
    expect(renamedTag!.id).toBe(tagRow.id);
  });
});
