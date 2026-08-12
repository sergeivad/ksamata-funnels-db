import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase11, LINK_COLUMNS } from '../scripts/migrate-phase11';

const dir = mkdtempSync(join(tmpdir(), 'phase11-'));
const dbPath = join(dir, 'test.db');
copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Воронка без ссылок ни в колонках, ни в блоке — чистая точка отсчёта. */
function freshFunnel(): number {
  const num =
    ((sqlite.prepare(`SELECT MAX(num) AS m FROM funnels`).get() as { m: number | null }).m ?? 0) + 1;
  // source_id NOT NULL — берём любой существующий: сама воронка тесту не важна,
  // важно, что у неё пустые и колонки, и блок.
  const ref = (t: string) => (sqlite.prepare(`SELECT id FROM ${t} LIMIT 1`).get() as { id: number }).id;
  return sqlite
    .prepare(
      `INSERT INTO funnels (num, source_id, product_id, contractor_id, product_name, variant, status)
       VALUES (?, ?, ?, ?, 'тест', '', 'active')`
    )
    .run(num, ref('sources'), ref('products'), ref('contractors')).lastInsertRowid as number;
}

function setCol(id: number, col: string, value: string) {
  sqlite.prepare(`UPDATE funnels SET ${col} = ? WHERE id = ?`).run(value, id);
}

function addBlockItem(funnelId: number, label: string, url: string, enabled = 1) {
  let blockId = (
    sqlite
      .prepare(`SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`)
      .get(funnelId) as { id: number } | undefined
  )?.id;
  if (blockId === undefined) {
    blockId = sqlite
      .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', ?, 'common')`)
      .run(funnelId, enabled).lastInsertRowid as number;
  }
  const pos =
    ((
      sqlite.prepare(`SELECT MAX(position) AS m FROM funnel_block_items WHERE block_id = ?`).get(blockId) as {
        m: number | null;
      }
    ).m ?? -1) + 1;
  sqlite
    .prepare(`INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, ?, ?, ?)`)
    .run(blockId, label, url, pos);
}

/** Создаёт блок «Ссылки» в нужном режиме, без пунктов (или переводит в него существующий). */
function makeLinksBlock(funnelId: number, mode: 'common' | 'by_time', enabled = 1): number {
  const existing = sqlite
    .prepare(`SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`)
    .get(funnelId) as { id: number } | undefined;
  if (existing) {
    sqlite.prepare(`UPDATE funnel_blocks SET mode = ? WHERE id = ?`).run(mode, existing.id);
    return existing.id;
  }
  return sqlite
    .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'links', ?, ?)`)
    .run(funnelId, enabled, mode).lastInsertRowid as number;
}

function blockItemSlots(funnelId: number): (string | null)[] {
  return (
    sqlite
      .prepare(
        `SELECT i.slot FROM funnel_block_items i
           JOIN funnel_blocks b ON b.id = i.block_id
          WHERE b.funnel_id = ? AND b.kind = 'links'
          ORDER BY i.position`
      )
      .all(funnelId) as { slot: string | null }[]
  ).map((r) => r.slot);
}

function blockItems(funnelId: number): { label: string; url: string }[] {
  return sqlite
    .prepare(
      `SELECT i.label, i.url FROM funnel_block_items i
         JOIN funnel_blocks b ON b.id = i.block_id
        WHERE b.funnel_id = ? AND b.kind = 'links'
        ORDER BY i.position`
    )
    .all(funnelId) as { label: string; url: string }[];
}

function cols(funnelId: number): Record<string, string> {
  return sqlite
    .prepare(`SELECT ${LINK_COLUMNS.map((c) => c.col).join(', ')} FROM funnels WHERE id = ?`)
    .get(funnelId) as Record<string, string>;
}

function blockEnabled(funnelId: number): number | undefined {
  return (
    sqlite
      .prepare(`SELECT enabled FROM funnel_blocks WHERE funnel_id = ? AND kind = 'links'`)
      .get(funnelId) as { enabled: number } | undefined
  )?.enabled;
}

beforeEach(() => {
  sqlite.exec('BEGIN');
});

afterEach(() => {
  sqlite.exec('ROLLBACK');
});

describe('Phase-11: ссылки и дашборды переезжают в блок', () => {
  it('переносит все семь колонок, каждую со своей подписью', () => {
    const id = freshFunnel();
    LINK_COLUMNS.forEach(({ col }, i) => setCol(id, col, `https://gc.example.ru/${i}`));

    const result = runMigratePhase11(sqlite);

    expect(result.moved).toBeGreaterThanOrEqual(7);
    expect(blockItems(id)).toEqual(
      LINK_COLUMNS.map(({ label }, i) => ({ label, url: `https://gc.example.ru/${i}` }))
    );
    expect(Object.values(cols(id)).every((v) => v === '')).toBe(true);
  });

  it('не плодит дубль, если адрес уже в блоке под той же подписью — регистр и хвостовой слэш не в счёт', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://GC.example.ru/dash/');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/dash');

    runMigratePhase11(sqlite);

    expect(blockItems(id)).toEqual([{ label: 'Дашборд продаж', url: 'https://GC.example.ru/dash/' }]);
    expect(cols(id).dash_sales_url).toBe('');
  });

  it('не плодит дубль, если тот же адрес лежит в блоке под ДРУГОЙ подписью', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Регистрации всего', 'https://gc.example.ru/same');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/same');

    runMigratePhase11(sqlite);

    expect(blockItems(id)).toEqual([{ label: 'Регистрации всего', url: 'https://gc.example.ru/same' }]);
  });

  it('дописывает вторым пунктом, когда подпись занята другим адресом (случай f9/f16)', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://gc.example.ru/wrong');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/right');

    const result = runMigratePhase11(sqlite);

    expect(result.moved).toBeGreaterThanOrEqual(1);
    expect(blockItems(id)).toEqual([
      { label: 'Дашборд продаж', url: 'https://gc.example.ru/wrong' },
      { label: 'Дашборд продаж', url: 'https://gc.example.ru/right' },
    ]);
  });

  it('в блоке «по времени» перенесённый пункт попадает в слот 15:00, а не в невидимый NULL', () => {
    const id = freshFunnel();
    makeLinksBlock(id, 'by_time');
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/byTime');

    runMigratePhase11(sqlite);

    expect(blockItemSlots(id)).toEqual(['15']);
    expect(blockItems(id)).toEqual([{ label: 'Дашборд продаж', url: 'https://gc.example.ru/byTime' }]);
  });

  it('в общем блоке (и во вновь созданном) перенесённый пункт остаётся slot = NULL', () => {
    const id = freshFunnel();
    // Блока ещё нет — фаза создаёт его сама, и он всегда 'common'.
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/common');

    runMigratePhase11(sqlite);

    expect(blockItemSlots(id)).toEqual([null]);
  });

  it('очищает колонку с текстом вместо адреса, ничего не добавляя в блок', () => {
    const id = freshFunnel();
    setCol(id, 'dash_sales_url', 'уточнить у подрядчика');

    runMigratePhase11(sqlite);

    expect(blockItems(id)).toEqual([]);
    expect(cols(id).dash_sales_url).toBe('');
  });

  it('создаёт блок и включает его, если перенесла адрес', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://gc.example.ru/x', 0);
    setCol(id, 'regi_total_url', 'https://gc.example.ru/y');

    runMigratePhase11(sqlite);

    expect(blockEnabled(id)).toBe(1);
  });

  it('не включает блок, в который ничего не добавила', () => {
    const id = freshFunnel();
    addBlockItem(id, 'Дашборд продаж', 'https://gc.example.ru/dup', 0);
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/dup');

    runMigratePhase11(sqlite);

    expect(blockEnabled(id)).toBe(0);
  });

  it('идемпотентна: второй прогон уже ничего не находит', () => {
    const id = freshFunnel();
    setCol(id, 'dash_sales_url', 'https://gc.example.ru/once');

    runMigratePhase11(sqlite);
    const second = runMigratePhase11(sqlite);

    expect(second).toEqual({ moved: 0, cleared: 0 });
    expect(blockItems(id)).toEqual([{ label: 'Дашборд продаж', url: 'https://gc.example.ru/once' }]);
  });

  it('после прогона ни в одной воронке базы не остаётся заполненной колонки', () => {
    runMigratePhase11(sqlite);

    const where = LINK_COLUMNS.map((c) => `trim(coalesce(${c.col}, '')) <> ''`).join(' OR ');
    const left = sqlite.prepare(`SELECT COUNT(*) AS n FROM funnels WHERE ${where}`).get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('не теряет ни одного адреса живой базы: всё, что было в колонках, есть в блоке', () => {
    const key = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
    const where = LINK_COLUMNS.map((c) => `trim(coalesce(${c.col}, '')) <> ''`).join(' OR ');
    const before = (
      sqlite
        .prepare(`SELECT id, ${LINK_COLUMNS.map((c) => c.col).join(', ')} FROM funnels WHERE ${where}`)
        .all() as Record<string, string | number>[]
    ).map((row) => [
      row.id as number,
      LINK_COLUMNS.map((c) => String(row[c.col] ?? '').trim()).filter((u) => /^https?:\/\//i.test(u)),
    ] as const);

    runMigratePhase11(sqlite);

    for (const [id, urls] of before) {
      const inBlock = new Set(blockItems(id).map((i) => key(i.url)));
      for (const url of urls) {
        expect(inBlock.has(key(url))).toBe(true);
      }
    }
  });
});
