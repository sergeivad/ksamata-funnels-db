import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { clearMonitoringState } from './helpers/monitoring';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import { runMigratePhase9, LEGACY_LANDING_SOURCE_KIND } from '../scripts/migrate-phase9';
import { LANDING_SOURCE_KIND } from '../src/lib/monitor-targets';

const dir = mkdtempSync(join(tmpdir(), 'phase9-'));
const dbPath = join(dir, 'test.db');
copyDbForTest(join(__dirname, '../../ksamata_funnels.db'), dbPath);
const sqlite = new Database(dbPath);
runMigratePhase6(sqlite);

afterAll(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  clearMonitoringState(sqlite);
});

function addTarget(url: string, sourceKind: string, enabled = 1, manualOverride = 0) {
  sqlite
    .prepare(
      `INSERT INTO monitor_targets (url, source_kind, enabled, manual_override) VALUES (?, ?, ?, ?)`
    )
    .run(url, sourceKind, enabled, manualOverride);
}

function addPref(sourceKind: string, enabled: number) {
  sqlite
    .prepare(`INSERT INTO monitor_source_kind_prefs (source_kind, enabled) VALUES (?, ?)`)
    .run(sourceKind, enabled);
}

function kindOf(url: string): string | undefined {
  return (
    sqlite.prepare(`SELECT source_kind FROM monitor_targets WHERE url = ?`).get(url) as
      | { source_kind: string }
      | undefined
  )?.source_kind;
}

function prefs(): Record<string, number> {
  const rows = sqlite
    .prepare(`SELECT source_kind, enabled FROM monitor_source_kind_prefs`)
    .all() as { source_kind: string; enabled: number }[];
  return Object.fromEntries(rows.map((r) => [r.source_kind, r.enabled]));
}

describe('Phase-9: лендинг воронки сливается с группой «Лендинги»', () => {
  it('переводит цели старого вида в landings, не трогая остальные группы', () => {
    addTarget('https://lp.example.ru/from-field', LEGACY_LANDING_SOURCE_KIND);
    addTarget('https://lp.example.ru/from-block', LANDING_SOURCE_KIND);
    addTarget('https://gc.example.ru/dash', 'links', 0);

    const result = runMigratePhase9(sqlite);

    expect(result.retargeted).toBe(1);
    expect(kindOf('https://lp.example.ru/from-field')).toBe(LANDING_SOURCE_KIND);
    expect(kindOf('https://lp.example.ru/from-block')).toBe(LANDING_SOURCE_KIND);
    expect(kindOf('https://gc.example.ru/dash')).toBe('links');
  });

  it('не трогает enabled и manual_override целей', () => {
    addTarget('https://lp.example.ru/off-by-hand', LEGACY_LANDING_SOURCE_KIND, 0, 1);

    runMigratePhase9(sqlite);

    const row = sqlite
      .prepare(`SELECT enabled, manual_override FROM monitor_targets WHERE url = ?`)
      .get('https://lp.example.ru/off-by-hand') as { enabled: number; manual_override: number };
    expect(row.enabled).toBe(0);
    expect(row.manual_override).toBe(1);
  });

  it('переносит решение по старой группе на landings, если по ней решения не было', () => {
    addPref(LEGACY_LANDING_SOURCE_KIND, 0);

    runMigratePhase9(sqlite);

    expect(prefs()).toEqual({ [LANDING_SOURCE_KIND]: 0 });
  });

  it('при двух решениях побеждает «выключено» — оно и есть решение человека', () => {
    addPref(LEGACY_LANDING_SOURCE_KIND, 0);
    addPref(LANDING_SOURCE_KIND, 1);

    runMigratePhase9(sqlite);

    expect(prefs()).toEqual({ [LANDING_SOURCE_KIND]: 0 });
  });

  it('оставляет решение по landings, когда по старой группе его не было', () => {
    addPref(LANDING_SOURCE_KIND, 0);

    runMigratePhase9(sqlite);

    expect(prefs()).toEqual({ [LANDING_SOURCE_KIND]: 0 });
  });

  it('идемпотентна: повторный прогон ничего не меняет', () => {
    addTarget('https://lp.example.ru/from-field', LEGACY_LANDING_SOURCE_KIND);
    addPref(LEGACY_LANDING_SOURCE_KIND, 0);

    runMigratePhase9(sqlite);
    const second = runMigratePhase9(sqlite);

    expect(second.retargeted).toBe(0);
    expect(kindOf('https://lp.example.ru/from-field')).toBe(LANDING_SOURCE_KIND);
    expect(prefs()).toEqual({ [LANDING_SOURCE_KIND]: 0 });
  });

  it('молча пропускает базу без таблиц мониторинга', () => {
    const bare = new Database(':memory:');
    expect(() => runMigratePhase9(bare)).not.toThrow();
    bare.close();
  });
});
