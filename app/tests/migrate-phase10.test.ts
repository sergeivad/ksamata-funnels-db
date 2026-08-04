import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase10, splitLandingField } from '../scripts/migrate-phase10';

const dir = mkdtempSync(join(tmpdir(), 'phase10-'));
const dbPath = join(dir, 'test.db');
copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Воронка без лендингов ни в колонке, ни в блоке — чистая точка отсчёта. */
function freshFunnel(): number {
  const num =
    ((sqlite.prepare(`SELECT MAX(num) AS m FROM funnels`).get() as { m: number | null }).m ?? 0) + 1;
  // source_id NOT NULL — берём любой существующий: сама воронка тесту не важна,
  // важно, что у неё пустые и колонка, и блок.
  const ref = (t: string) => (sqlite.prepare(`SELECT id FROM ${t} LIMIT 1`).get() as { id: number }).id;
  const id = sqlite
    .prepare(
      `INSERT INTO funnels (num, source_id, product_id, contractor_id, product_name, variant, landing_url, status)
       VALUES (?, ?, ?, ?, 'тест', '', '', 'active')`
    )
    .run(num, ref('sources'), ref('products'), ref('contractors')).lastInsertRowid as number;
  return id;
}

function setField(id: number, value: string) {
  sqlite.prepare(`UPDATE funnels SET landing_url = ? WHERE id = ?`).run(value, id);
}

function addBlockItem(funnelId: number, url: string, enabled = 1) {
  let blockId = (
    sqlite
      .prepare(`SELECT id FROM funnel_blocks WHERE funnel_id = ? AND kind = 'landings'`)
      .get(funnelId) as { id: number } | undefined
  )?.id;
  if (blockId === undefined) {
    blockId = sqlite
      .prepare(
        `INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, 'landings', ?, 'common')`
      )
      .run(funnelId, enabled).lastInsertRowid as number;
  }
  const pos =
    ((
      sqlite.prepare(`SELECT MAX(position) AS m FROM funnel_block_items WHERE block_id = ?`).get(blockId) as {
        m: number | null;
      }
    ).m ?? -1) + 1;
  sqlite
    .prepare(`INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, NULL, '', ?, ?)`)
    .run(blockId, url, pos);
}

function blockUrls(funnelId: number): string[] {
  return (
    sqlite
      .prepare(
        `SELECT i.url FROM funnel_block_items i
           JOIN funnel_blocks b ON b.id = i.block_id
          WHERE b.funnel_id = ? AND b.kind = 'landings'
          ORDER BY i.position`
      )
      .all(funnelId) as { url: string }[]
  ).map((r) => r.url);
}

function field(funnelId: number): string {
  return (sqlite.prepare(`SELECT landing_url FROM funnels WHERE id = ?`).get(funnelId) as {
    landing_url: string;
  }).landing_url;
}

function blockEnabled(funnelId: number): number | undefined {
  return (
    sqlite
      .prepare(`SELECT enabled FROM funnel_blocks WHERE funnel_id = ? AND kind = 'landings'`)
      .get(funnelId) as { enabled: number } | undefined
  )?.enabled;
}

beforeEach(() => {
  sqlite.exec('BEGIN');
});

afterEach(() => {
  sqlite.exec('ROLLBACK');
});

describe('splitLandingField', () => {
  it('разбирает многоссылочную колонку и чистит хвостовые кавычки', () => {
    expect(splitLandingField('https://a.ru / https://b.ru/boo"')).toEqual([
      'https://a.ru',
      'https://b.ru/boo',
    ]);
  });

  it('отбрасывает всё, что не http(s) — заметки вроде «сайты» адресом не станут', () => {
    expect(splitLandingField('сайты https://a.ru геткурс')).toEqual(['https://a.ru']);
    expect(splitLandingField('')).toEqual([]);
    expect(splitLandingField(null)).toEqual([]);
  });
});

describe('Phase-10: лендинг переезжает в блок', () => {
  it('переносит адрес из колонки в блок и очищает колонку', () => {
    const id = freshFunnel();
    setField(id, 'https://lp.example.ru/a');

    const result = runMigratePhase10(sqlite);

    expect(result.moved).toBeGreaterThanOrEqual(1);
    expect(blockUrls(id)).toEqual(['https://lp.example.ru/a']);
    expect(field(id)).toBe('');
  });

  it('дописывает к существующим адресам блока, не трогая их порядок', () => {
    const id = freshFunnel();
    addBlockItem(id, 'https://lp.example.ru/first');
    setField(id, 'https://lp.example.ru/second');

    runMigratePhase10(sqlite);

    expect(blockUrls(id)).toEqual(['https://lp.example.ru/first', 'https://lp.example.ru/second']);
  });

  it('не плодит дубль, если адрес уже в блоке — регистр и хвостовой слэш не в счёт', () => {
    const id = freshFunnel();
    addBlockItem(id, 'https://LP.example.ru/dup/');
    setField(id, 'https://lp.example.ru/dup');

    runMigratePhase10(sqlite);

    expect(blockUrls(id)).toEqual(['https://LP.example.ru/dup/']);
    expect(field(id)).toBe('');
  });

  it('включает блок, в который перенесла адрес — иначе страница исчезла бы из виду', () => {
    const id = freshFunnel();
    addBlockItem(id, 'https://lp.example.ru/x', 0);
    setField(id, 'https://lp.example.ru/y');

    runMigratePhase10(sqlite);

    expect(blockEnabled(id)).toBe(1);
  });

  it('очищает колонку с текстом вместо адреса, ничего не добавляя в блок', () => {
    const id = freshFunnel();
    setField(id, 'уточнить у подрядчика');

    runMigratePhase10(sqlite);

    expect(blockUrls(id)).toEqual([]);
    expect(field(id)).toBe('');
  });

  it('идемпотентна: второй прогон уже ничего не находит', () => {
    const id = freshFunnel();
    setField(id, 'https://lp.example.ru/once');

    runMigratePhase10(sqlite);
    const second = runMigratePhase10(sqlite);

    expect(second).toEqual({ moved: 0, cleared: 0 });
    expect(blockUrls(id)).toEqual(['https://lp.example.ru/once']);
  });

  it('после прогона ни в одной воронке базы не остаётся заполненной колонки', () => {
    runMigratePhase10(sqlite);

    const left = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM funnels WHERE trim(coalesce(landing_url, '')) <> ''`)
      .get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('не теряет ни одного адреса живой базы: всё, что было в колонке, есть в блоке', () => {
    const before = (
      sqlite.prepare(`SELECT id, landing_url FROM funnels WHERE trim(coalesce(landing_url, '')) <> ''`).all() as {
        id: number;
        landing_url: string;
      }[]
    ).map((f) => [f.id, splitLandingField(f.landing_url)] as const);

    runMigratePhase10(sqlite);

    for (const [id, urls] of before) {
      const inBlock = new Set(blockUrls(id).map((u) => u.toLowerCase().replace(/\/+$/, '')));
      for (const url of urls) {
        expect(inBlock.has(url.toLowerCase().replace(/\/+$/, ''))).toBe(true);
      }
    }
  });
});
