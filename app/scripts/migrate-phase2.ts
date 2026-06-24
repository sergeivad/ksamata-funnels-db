/**
 * Phase-2 migration: creates tables channels, directions, funnel_links
 * and seeds channels + directions with canonical values.
 *
 * Design:
 *  - Uses raw SQL via better-sqlite3 (accessed through drizzle's $client)
 *    so it is safe to run before Drizzle knows the tables exist.
 *  - Fully idempotent: CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE.
 *
 * Run against the real DB:
 *   cd app/
 *   FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase2.ts
 */

import type { AnyDB } from '../src/db/client';

// ─── Seed data ────────────────────────────────────────────────────────────────

const CHANNELS: string[] = ['Ютуб', 'Яндекс', 'ВК', 'МАКС', 'Перелив'];

const DIRECTIONS: string[] = [
  'Органика',
  'Реклама',
  'РСЯ',
  'In Stream',
  'Маркетплатформа',
  'Посевы',
  'Ретаргет',
  'Перелив с БОО',
  'Перелив с ДБО',
  'Квиз',
];

// ─── Core migration function (injectable DB for testing) ──────────────────────

export function runMigratePhase2(db: AnyDB): void {
  // Access the underlying better-sqlite3 Database instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlite = (db as any).$client as import('better-sqlite3').Database;

  // Enable foreign keys for this connection
  sqlite.pragma('foreign_keys = ON');

  // ── Create tables (idempotent) ──────────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS directions (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS funnel_links (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      funnel_id INTEGER NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
      label     TEXT    NOT NULL DEFAULT '',
      url       TEXT    NOT NULL DEFAULT '',
      position  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_funnel_links_funnel ON funnel_links(funnel_id);
  `);

  // ── Seed channels (get-or-create by name) ──────────────────────────────────

  const insertChannel = sqlite.prepare(
    'INSERT OR IGNORE INTO channels (name) VALUES (?)'
  );
  for (const name of CHANNELS) {
    insertChannel.run(name);
  }

  // ── Seed directions (get-or-create by name) ─────────────────────────────────

  const insertDirection = sqlite.prepare(
    'INSERT OR IGNORE INTO directions (name) VALUES (?)'
  );
  for (const name of DIRECTIONS) {
    insertDirection.run(name);
  }

  console.log(
    `Phase-2 migration complete. ` +
    `channels: ${CHANNELS.length}, directions: ${DIRECTIONS.length}`
  );
}

// ─── CLI entry point ──────────────────────────────────────────────────────────
// Run with:  FUNNELS_DB_PATH=../ksamata_funnels.db npx tsx scripts/migrate-phase2.ts
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require('../src/db/client');
  console.log('Phase-2 migration: creating channels, directions, funnel_links...\n');
  runMigratePhase2(db);
}
