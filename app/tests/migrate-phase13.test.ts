import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbForTest } from './helpers/db';
import { clearMonitoringState } from './helpers/monitoring';
import { runMigratePhase6 } from '../scripts/migrate-phase6';
import { runMigratePhase13 } from '../scripts/migrate-phase13';
import { PHASE13_NEW_KIND, PHASE13_OLD_KIND } from '../scripts/migrate-phase13-data';
import { isBlockKind } from '../src/lib/blocks';

const dir = mkdtempSync(join(tmpdir(), 'phase13-'));
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

function funnelId(): number {
  return (sqlite.prepare(`SELECT id FROM funnels ORDER BY id LIMIT 1`).get() as { id: number }).id;
}

function setBlockKind(funnelId: number, kind: string): number {
  sqlite
    .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, ?, 1, 'common')`)
    .run(funnelId, kind);
  return sqlite.prepare(`SELECT last_insert_rowid() AS id`).get() as unknown as number;
}

function blockKinds(funnelId: number): string[] {
  return (
    sqlite
      .prepare(`SELECT kind FROM funnel_blocks WHERE funnel_id = ? ORDER BY kind`)
      .all(funnelId) as { kind: string }[]
  ).map((r) => r.kind);
}

function dropBlocks(funnelId: number) {
  sqlite
    .prepare(`DELETE FROM funnel_blocks WHERE funnel_id = ? AND kind IN (?, ?)`)
    .run(funnelId, PHASE13_OLD_KIND, PHASE13_NEW_KIND);
}

describe('Phase-13: meditation → upsell', () => {
  it('новый слаг — вид блока, старого в реестре нет', () => {
    expect(isBlockKind(PHASE13_NEW_KIND)).toBe(true);
    expect(isBlockKind(PHASE13_OLD_KIND)).toBe(false);
  });

  it('переводит блок воронки на новый слаг', () => {
    const f = funnelId();
    dropBlocks(f);
    setBlockKind(f, PHASE13_OLD_KIND);

    const res = runMigratePhase13(sqlite);

    expect(res.blocks).toBeGreaterThanOrEqual(1);
    expect(blockKinds(f)).toContain(PHASE13_NEW_KIND);
    expect(blockKinds(f)).not.toContain(PHASE13_OLD_KIND);
    dropBlocks(f);
  });

  it('идемпотентна: повторный прогон ничего не меняет', () => {
    const f = funnelId();
    dropBlocks(f);
    setBlockKind(f, PHASE13_OLD_KIND);
    runMigratePhase13(sqlite);

    const second = runMigratePhase13(sqlite);

    expect(second.blocks).toBe(0);
    expect(second.targets).toBe(0);
    expect(second.collisions).toEqual([]);
    expect(blockKinds(f)).toContain(PHASE13_NEW_KIND);
    dropBlocks(f);
  });

  it('в базе не остаётся ни одного блока со старым слагом', () => {
    runMigratePhase13(sqlite);
    const left = sqlite
      .prepare(`SELECT count(*) AS n FROM funnel_blocks WHERE kind = ?`)
      .get(PHASE13_OLD_KIND) as { n: number };
    expect(left.n).toBe(0);
  });

  it('воронку с блоками под обоими слагами не роняет, а сообщает о ней', () => {
    const f = funnelId();
    dropBlocks(f);
    setBlockKind(f, PHASE13_OLD_KIND);
    setBlockKind(f, PHASE13_NEW_KIND);

    const res = runMigratePhase13(sqlite);

    expect(res.collisions).toContain(f);
    // Старый блок оставлен на месте: слить два в один автоматически нельзя.
    expect(blockKinds(f)).toContain(PHASE13_OLD_KIND);
    expect(blockKinds(f)).toContain(PHASE13_NEW_KIND);
    dropBlocks(f);
  });

  it('переименовывает группу мониторинга, сохраняя историю проверок', () => {
    sqlite
      .prepare(`INSERT INTO monitor_targets (url, source_kind, enabled) VALUES (?, ?, 1)`)
      .run('https://med.example.ru/one', PHASE13_OLD_KIND);
    const id = (
      sqlite.prepare(`SELECT id FROM monitor_targets WHERE url = ?`).get('https://med.example.ru/one') as {
        id: number;
      }
    ).id;
    sqlite
      .prepare(`INSERT INTO monitor_state (target_id, status, checked_at) VALUES (?, 'up', datetime('now'))`)
      .run(id);

    const res = runMigratePhase13(sqlite);

    expect(res.targets).toBe(1);
    const row = sqlite
      .prepare(`SELECT id, source_kind FROM monitor_targets WHERE url = ?`)
      .get('https://med.example.ru/one') as { id: number; source_kind: string };
    expect(row.source_kind).toBe(PHASE13_NEW_KIND);
    // Тот же id — значит monitor_state и monitor_events никуда не делись.
    expect(row.id).toBe(id);
    expect(
      (sqlite.prepare(`SELECT count(*) AS n FROM monitor_state WHERE target_id = ?`).get(id) as { n: number }).n
    ).toBe(1);
  });

  it('переносит решение человека по группе', () => {
    sqlite
      .prepare(`INSERT INTO monitor_source_kind_prefs (source_kind, enabled) VALUES (?, 1)`)
      .run(PHASE13_OLD_KIND);

    const res = runMigratePhase13(sqlite);

    expect(res.prefs).toBe(1);
    const pref = sqlite
      .prepare(`SELECT enabled FROM monitor_source_kind_prefs WHERE source_kind = ?`)
      .get(PHASE13_NEW_KIND) as { enabled: number } | undefined;
    expect(pref?.enabled).toBe(1);
    expect(
      sqlite.prepare(`SELECT 1 FROM monitor_source_kind_prefs WHERE source_kind = ?`).get(PHASE13_OLD_KIND)
    ).toBeUndefined();
  });

  it('решение под новым слагом свежее — старое его не затирает', () => {
    sqlite
      .prepare(`INSERT INTO monitor_source_kind_prefs (source_kind, enabled) VALUES (?, 1)`)
      .run(PHASE13_OLD_KIND);
    sqlite
      .prepare(`INSERT INTO monitor_source_kind_prefs (source_kind, enabled) VALUES (?, 0)`)
      .run(PHASE13_NEW_KIND);

    runMigratePhase13(sqlite);

    const pref = sqlite
      .prepare(`SELECT enabled FROM monitor_source_kind_prefs WHERE source_kind = ?`)
      .get(PHASE13_NEW_KIND) as { enabled: number };
    expect(pref.enabled).toBe(0);
    expect(
      sqlite.prepare(`SELECT 1 FROM monitor_source_kind_prefs WHERE source_kind = ?`).get(PHASE13_OLD_KIND)
    ).toBeUndefined();
  });
});
