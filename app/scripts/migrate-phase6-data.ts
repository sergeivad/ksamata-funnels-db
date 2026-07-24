/**
 * DDL Phase-6 (мониторинг доступности лендов).
 * Единый источник правды для migrate-phase6.ts (tsx/тесты) и Docker-раннера.
 */

export const PHASE6_DDL = `
CREATE TABLE IF NOT EXISTS monitor_targets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL UNIQUE,
  source_kind TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitor_targets_enabled ON monitor_targets(enabled);

CREATE TABLE IF NOT EXISTS monitor_target_funnels (
  target_id INTEGER NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,
  funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  PRIMARY KEY (target_id, funnel_id)
);
CREATE INDEX IF NOT EXISTS idx_mtf_funnel ON monitor_target_funnels(funnel_id);

CREATE TABLE IF NOT EXISTS monitor_state (
  target_id            INTEGER PRIMARY KEY REFERENCES monitor_targets(id) ON DELETE CASCADE,
  status               TEXT    NOT NULL DEFAULT 'unknown'
                         CHECK(status IN ('up','slow','down','unknown')),
  http_status          INTEGER,
  final_url            TEXT    NOT NULL DEFAULT '',
  error                TEXT    NOT NULL DEFAULT '',
  latency_ms           INTEGER,
  checked_at           TEXT,
  since                TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_monitor_state_status ON monitor_state(status);

CREATE TABLE IF NOT EXISTS monitor_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id   INTEGER NOT NULL REFERENCES monitor_targets(id) ON DELETE CASCADE,
  from_status TEXT    NOT NULL,
  to_status   TEXT    NOT NULL,
  http_status INTEGER,
  error       TEXT    NOT NULL DEFAULT '',
  at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_monitor_events_target ON monitor_events(target_id);
CREATE INDEX IF NOT EXISTS idx_monitor_events_at     ON monitor_events(at);
`;
