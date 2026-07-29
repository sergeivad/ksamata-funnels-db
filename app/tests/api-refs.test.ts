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
  isReservedFunnelTypeName,
  FunnelTypeAxisConflictError,
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

    // В реальном пайплайне зеркальный тег для funnel_types заводит
    // materializeFunnelTags → createRef(db, 'tags', chip.name) на первом же
    // сохранении воронки этого типа (см. getRefUsage в refs.ts) — этот тест
    // кладёт его вручную, чтобы проверить именно проводку refTagNameFor →
    // renameOrMergeTag внутри renameRef изолированно, не поднимая полный
    // updateFunnel/computeTagSet ради одного узкого утверждения.
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

// Пункт 1 финальной рецензии: имя funnel_types, похожее на осевой тег, нельзя
// завести ни при создании, ни при переименовании — иначе оно материализуется
// КАК ОСЕВОЙ тег (refTagNameFor(FUNNEL_TYPE_KIND, value) возвращает value
// дословно, без двоеточия) и переписывает чужую ось у каждой воронки этого
// типа, воспроизведено рецензентом на копии: «ЖИВО / НИМБ / Яндекс / РСЯ»
// стала «ПОДДЕЛКА / НИМБ / Яндекс / РСЯ».
describe('funnel_types — барьер против осевых имён', () => {
  it('isReservedFunnelTypeName true только для funnel_types + осевого имени', () => {
    expect(isReservedFunnelTypeName('funnel_types', 'АВ Продукт: ЖИВО')).toBe(true);
    expect(isReservedFunnelTypeName('funnel_types', 'АВ Подрядчик: НИМБ')).toBe(true);
    // Тот же текст для любого другого вида — не наша забота, барьер только
    // для funnel_types (продукт по имени "АВ Продукт: X" — не этот случай,
    // но даже если бы был, четыре оси имеют право на любые собственные имена).
    expect(isReservedFunnelTypeName('products', 'АВ Продукт: ЖИВО')).toBe(false);
    // Обычное имя маркера барьер не трогает.
    expect(isReservedFunnelTypeName('funnel_types', 'АВ Квиз')).toBe(false);
  });

  it('createRef отказывает заводить funnel_types с осевым именем', () => {
    expect(() => createRef(testDb, 'funnel_types', 'АВ Продукт: ПОДДЕЛКА'))
      .toThrow(FunnelTypeAxisConflictError);

    // Строка не должна была попасть в справочник вовсе.
    expect(getRefByName(testDb, 'funnel_types', 'АВ Продукт: ПОДДЕЛКА')).toBeUndefined();
  });

  it('createRef с тем же текстом для products (не funnel_types) не отказывает — барьер точечный', () => {
    // Мутационная проверка того, что isReservedFunnelTypeName действительно
    // проверяет kind, а не только форму имени: то же самое имя для другого
    // справочника обязано пройти.
    const row = createRef(testDb, 'products', 'АВ Продукт: НЕОЖИДАННЫЙ ТЕСТ');
    expect(row.name).toBe('АВ Продукт: НЕОЖИДАННЫЙ ТЕСТ');
    // Уборка — не оставлять постороннюю строку в общей тестовой БД.
    deleteRef(testDb, 'products', row.id);
  });

  it('renameRef отказывает переименовывать funnel_types в осевое имя', () => {
    const created = createRef(testDb, 'funnel_types', 'АВ Тест-Барьер-Ренейм');
    const res = renameRef(testDb, 'funnel_types', created.id, 'АВ Подрядчик: НИМБ');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('axis_conflict');

    // Имя не изменилось.
    expect(getRefByName(testDb, 'funnel_types', 'АВ Тест-Барьер-Ренейм')).toBeDefined();
    expect(getRefByName(testDb, 'funnel_types', 'АВ Подрядчик: НИМБ')).toBeUndefined();

    deleteRef(testDb, 'funnel_types', created.id);
  });

  it('регресс: без барьера имя типа переписывает чужую ось воронки — ровно находка рецензента', async () => {
    // Воспроизводит целиком то, что нашёл рецензент на копии базы: заводим
    // строку funnel_types с осевым именем В ОБХОД createRef (raw SQL — как
    // если бы барьера не было вовсе), назначаем её воронке через updateFunnel
    // (нормальный публичный путь) и смотрим, что getFunnel вернёт. Без этого
    // теста «барьер существует» и «барьер защищает от реальной порчи» —
    // два разных утверждения, и проверено здесь второе.
    const { updateFunnel, getFunnel } = await import('../src/lib/funnels');

    const anyFunnel = testDb
      .select({ id: schema.funnels.id })
      .from(schema.funnels)
      .limit(1)
      .get() as { id: number };
    const before = getFunnel(testDb, anyFunnel.id)!;
    const originalAxes = before.axes;
    const originalType = before.funnelType;

    const badTypeName = 'АВ Продукт: ПОДДЕЛКА-РЕГРЕСС';
    sqlite.prepare('INSERT INTO funnel_types (name) VALUES (?)').run(badTypeName);

    updateFunnel(testDb, anyFunnel.id, { funnelType: badTypeName });
    const after = getFunnel(testDb, anyFunnel.id)!;

    // Это и есть порча: значение оси «Продукт» стало текстом ИМЕНИ ТИПА,
    // потому что refTagNameFor(FUNNEL_TYPE_KIND, value) вернул его дословно,
    // и tagNamesToAxes прочитал получившийся тег как «АВ Продукт: …». Ось
    // денормализована в теги (нет отдельной колонки), так что порча реальна
    // и необратима обычным откатом одного лишь funnelType — восстанавливать
    // ниже приходится ЯВНО все четыре оси, не только тип.
    expect(after.axes.product).toBe('ПОДДЕЛКА-РЕГРЕСС');
    expect(after.axes.product).not.toBe(originalAxes.product);

    // Уборка: вернуть воронку в исходное состояние (все оси + тип) и убрать
    // тестовый тип — остальные тесты файла делят одну и ту же тестовую БД.
    updateFunnel(testDb, anyFunnel.id, { ...originalAxes, funnelType: originalType ?? '' });
    const typeRow = getRefByName(testDb, 'funnel_types', badTypeName)!;
    deleteRef(testDb, 'funnel_types', typeRow.id);
    expect(getFunnel(testDb, anyFunnel.id)!.axes).toEqual(originalAxes);
  });
});
