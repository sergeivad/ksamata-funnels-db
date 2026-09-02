/**
 * Фаза 17 — осевые FK-колонки следуют за тегами.
 *
 * Состояние «до фазы» каждый тест строит сам, приёмом фаз 12/14/15:
 * репозиторную базу фаза однажды пройдёт, и «в колонке лежит расхождение»
 * перестанет быть правдой ровно в тот день, когда это случится.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { runMigratePhase17 } from '../scripts/migrate-phase17';
import { PHASE17_AXES } from '../scripts/migrate-phase17-data';
import { AXIS_PREFIXES } from '../src/lib/ab-tags';

let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'phase17-'));
  const dbPath = join(dir, 'test.db');
  copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
  sqlite = new Database(dbPath);
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** id справочной строки по имени; заводит её, если ещё нет. */
function refId(table: string, name: string): number {
  const row = sqlite.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as
    | { id: number }
    | undefined;
  if (row) return row.id;
  return Number(sqlite.prepare(`INSERT INTO ${table}(name) VALUES(?)`).run(name).lastInsertRowid);
}

/** Первая воронка, у которой ось проставлена тегом — на ней и ломаем. */
function funnelWithContractorTag(): { id: number; tagValue: string } {
  const row = sqlite
    .prepare(
      `SELECT f.id AS id, SUBSTR(t.name, LENGTH(?) + 1) AS tagValue
         FROM funnels f
         JOIN funnel_tags ft ON ft.funnel_id = f.id AND ft.tag_type = 'reg'
         JOIN tags t ON t.id = ft.tag_id AND t.name LIKE ? || '%'
        ORDER BY f.id LIMIT 1`
    )
    .get(AXIS_PREFIXES.contractor, AXIS_PREFIXES.contractor) as { id: number; tagValue: string };
  return row;
}

function contractorIdOf(funnelId: number): number {
  return (sqlite.prepare('SELECT contractor_id AS c FROM funnels WHERE id = ?').get(funnelId) as {
    c: number;
  }).c;
}

describe('фаза 17: колонка идёт за тегом', () => {
  it('чинит разошедшийся contractor_id и сообщает, что именно поменяла', () => {
    const { id, tagValue } = funnelWithContractorTag();
    const wrong = refId('contractors', 'ФАЗА17-ЧУЖОЙ');
    sqlite.prepare('UPDATE funnels SET contractor_id = ? WHERE id = ?').run(wrong, id);

    const result = runMigratePhase17(sqlite);

    const fix = result.fixed.find((f) => f.funnelId === id && f.axis === 'подрядчик');
    expect(fix).toBeDefined();
    expect(fix!.from).toBe('ФАЗА17-ЧУЖОЙ');
    expect(fix!.to).toBe(tagValue);
    expect(contractorIdOf(id)).toBe(refId('contractors', tagValue));
  });

  it('идемпотентна: второй прогон не находит работы', () => {
    const { id } = funnelWithContractorTag();
    sqlite
      .prepare('UPDATE funnels SET contractor_id = ? WHERE id = ?')
      .run(refId('contractors', 'ФАЗА17-ЧУЖОЙ'), id);

    expect(runMigratePhase17(sqlite).fixed.length).toBeGreaterThan(0);
    const second = runMigratePhase17(sqlite);
    expect(second.fixed).toEqual([]);
    expect(second.unresolved).toEqual([]);
  });

  it('на репозиторной базе после прогона расхождений не остаётся', () => {
    runMigratePhase17(sqlite);

    for (const axis of PHASE17_AXES) {
      const left = sqlite
        .prepare(
          `SELECT COUNT(*) AS n
             FROM funnels f
             JOIN funnel_tags ft ON ft.funnel_id = f.id AND ft.tag_type = 'reg'
             JOIN tags t ON t.id = ft.tag_id AND t.name LIKE ? || '%'
        LEFT JOIN ${axis.table} ref ON ref.id = f.${axis.column}
            WHERE COALESCE(ref.name, '') <> SUBSTR(t.name, LENGTH(?) + 1)`
        )
        .get(axis.prefix, axis.prefix) as { n: number };
      expect(left.n, `ось ${axis.label}`).toBe(0);
    }
  });

  /**
   * Черновик без осевых тегов — законное состояние (createDraftFunnel берёт
   * первое значение справочника и AV-теги не проставляет). Колонки NOT NULL,
   * так что «привести к тегу» здесь означало бы уронить вставку.
   */
  it('воронку без осевого тега не трогает', () => {
    const { id } = funnelWithContractorTag();
    sqlite.prepare(`DELETE FROM funnel_tags WHERE funnel_id = ?`).run(id);
    const before = contractorIdOf(id);

    const result = runMigratePhase17(sqlite);

    expect(result.fixed.some((f) => f.funnelId === id)).toBe(false);
    expect(contractorIdOf(id)).toBe(before);
  });

  /**
   * Тег с значением, которого нет в справочнике: строку справочника фаза
   * заводить не вправе — иначе опечатка в теге навсегда уезжает в /refs.
   */
  it('тег без строки справочника пропускает и докладывает', () => {
    const { id } = funnelWithContractorTag();
    const orphan = `${AXIS_PREFIXES.contractor}ФАЗА17-СИРОТА`;
    const tagId = Number(sqlite.prepare(`INSERT INTO tags(name) VALUES(?)`).run(orphan).lastInsertRowid);
    sqlite.prepare(`DELETE FROM funnel_tags WHERE funnel_id = ? AND tag_type = 'reg'`).run(id);
    sqlite
      .prepare(`INSERT INTO funnel_tags(funnel_id, tag_id, tag_type, position) VALUES(?,?, 'reg', 0)`)
      .run(id, tagId);
    const before = contractorIdOf(id);

    const result = runMigratePhase17(sqlite);

    expect(result.fixed.some((f) => f.funnelId === id)).toBe(false);
    const skipped = result.unresolved.find((f) => f.funnelId === id);
    expect(skipped?.to).toBe('ФАЗА17-СИРОТА');
    expect(contractorIdOf(id)).toBe(before);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS n FROM contractors WHERE name = ?').get('ФАЗА17-СИРОТА')
    ).toEqual({ n: 0 });
  });

  /**
   * source_id — не кэш осей: холод и ретаргет различает ТОЛЬКО он, при
   * одинаковых осях. Фаза обязана оставить его в покое.
   */
  it('source_id не трогает вовсе', () => {
    const before = sqlite
      .prepare('SELECT id, source_id FROM funnels ORDER BY id')
      .all() as { id: number; source_id: number }[];

    runMigratePhase17(sqlite);

    const after = sqlite
      .prepare('SELECT id, source_id FROM funnels ORDER BY id')
      .all() as { id: number; source_id: number }[];
    expect(after).toEqual(before);
  });
});

describe('фаза 17: константы', () => {
  /**
   * Префиксы объявлены в фазе отдельно от src/ (раннер бандлится для Docker
   * и src/ не тянет). Разъехаться им нельзя: фаза читала бы теги, которых
   * приложение не пишет, и «расхождений нет» означало бы «ничего не нашли».
   */
  it('префиксы осей совпадают с AXIS_PREFIXES приложения', () => {
    const byColumn = Object.fromEntries(PHASE17_AXES.map((a) => [a.column, a.prefix]));
    expect(byColumn.contractor_id).toBe(AXIS_PREFIXES.contractor);
    expect(byColumn.product_id).toBe(AXIS_PREFIXES.product);
  });

  /** Забыть здесь ось — значит молча перестать её сверять. */
  it('покрыты обе осевые FK-колонки funnels и только они', () => {
    expect(PHASE17_AXES.map((a) => a.column).sort()).toEqual(['contractor_id', 'product_id']);
  });
});
