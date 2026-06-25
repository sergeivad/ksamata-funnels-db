/**
 * Phase-3 DATA migration: distribute funnel_days columns + funnels dashboard
 * columns into funnel_blocks / funnel_block_items. Idempotent — a funnel that
 * already has any funnel_blocks row is skipped entirely.
 *
 * Run AFTER runMigratePhase3 (needs the new tables/columns).
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-funnel-data.ts
 */

type DB = import('better-sqlite3').Database;

// funnel_days column -> block kind (single-field unless processes)
const DAY_COLUMN_TO_KIND: { col: string; kind: string; labelCol?: string }[] = [
  { col: 'sales_page', kind: 'applications' },
  { col: 'tariffs',    kind: 'tariffs' },
  { col: 'oto',        kind: 'oto' },
  { col: 'bonuses',    kind: 'bonuses' },
  { col: 'meditation', kind: 'meditation' },
  { col: 'mission',    kind: 'processes', labelCol: 'mission_type' },
];

const DASHBOARD_COLUMNS: { col: string; label: string }[] = [
  { col: 'dash_sales_url',   label: 'Дашборд продаж' },
  { col: 'dash_pereliv_url', label: 'Дашборд перелива' },
  { col: 'regi_total_url',   label: 'Регистрации всего' },
  { col: 'regi_15_url',      label: 'Регистрации 15:00' },
  { col: 'regi_19_url',      label: 'Регистрации 19:00' },
  { col: 'regi_notime_url',  label: 'Регистрации без времени' },
  { col: 'predspisok_url',   label: 'Предсписок' },
];

type Item = { slot: '15' | '19' | null; label: string; url: string };

function createBlock(sqlite: DB, funnelId: number, kind: string, mode: string, items: Item[]): void {
  if (items.length === 0) return;
  const res = sqlite
    .prepare(`INSERT INTO funnel_blocks (funnel_id, kind, enabled, mode) VALUES (?, ?, 1, ?)`)
    .run(funnelId, kind, mode);
  const blockId = res.lastInsertRowid as number;
  const ins = sqlite.prepare(
    `INSERT INTO funnel_block_items (block_id, slot, label, url, position) VALUES (?, ?, ?, ?, ?)`,
  );
  items.forEach((it, i) => ins.run(blockId, it.slot, it.label, it.url, i));
}

export function migrateFunnelData(sqlite: DB): void {
  sqlite.pragma('foreign_keys = ON');
  const funnels = sqlite.prepare(`SELECT * FROM funnels`).all() as Record<string, unknown>[];
  const hasBlocks = sqlite.prepare(`SELECT 1 FROM funnel_blocks WHERE funnel_id = ? LIMIT 1`);
  const daysFor = sqlite.prepare(`SELECT * FROM funnel_days WHERE funnel_id = ? ORDER BY day_num`);

  const run = sqlite.transaction(() => {
    for (const f of funnels) {
      const funnelId = f.id as number;
      if (hasBlocks.get(funnelId)) continue; // idempotent skip

      const days = daysFor.all(funnelId) as Record<string, string>[];

      // landings
      const landing = String(f.landing_url ?? '').trim();
      if (landing) createBlock(sqlite, funnelId, 'landings', 'common', [{ slot: null, label: '', url: landing }]);

      // day-column blocks
      for (const { col, kind, labelCol } of DAY_COLUMN_TO_KIND) {
        const rows = days
          .filter((d) => String(d[col] ?? '').trim() !== '')
          .map((d) => ({
            slot: d.time_slot as '15' | '19',
            label: labelCol ? String(d[labelCol] ?? '').trim() : '',
            url: String(d[col]).trim(),
          }));
        if (rows.length === 0) continue;
        const slots = new Set(rows.map((r) => r.slot));
        const byTime = slots.has('15') && slots.has('19');
        const items: Item[] = rows.map((r) => ({ slot: byTime ? r.slot : null, label: r.label, url: r.url }));
        createBlock(sqlite, funnelId, kind, byTime ? 'by_time' : 'common', items);
      }

      // links from dashboard columns
      const linkItems: Item[] = DASHBOARD_COLUMNS
        .filter((d) => String(f[d.col] ?? '').trim() !== '')
        .map((d) => ({ slot: null, label: d.label, url: String(f[d.col]).trim() }));
      createBlock(sqlite, funnelId, 'links', 'common', linkItems);

      // rooms_replay_enabled
      const hasReplay = days.some(
        (d) => String(d.replay_url ?? '').trim() !== '' || String(d.web_replay ?? '').trim() !== '',
      );
      if (hasReplay) {
        sqlite.prepare(`UPDATE funnels SET rooms_replay_enabled = 1 WHERE id = ?`).run(funnelId);
      }
    }
  });
  run();
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPath = process.env.FUNNELS_DB_PATH ?? '../ksamata_funnels.db';
  const sqlite = new Database(dbPath);
  console.log(`Phase-3 data migration on: ${dbPath}`);
  migrateFunnelData(sqlite);
  sqlite.close();
  console.log('Phase-3 data migration done.');
}
