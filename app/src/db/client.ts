import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';

// Resolve DB path:
//   1. FUNNELS_DB_PATH env var (Docker/prod sets an absolute path; allowed as-is)
//   2. Default: repo root = one level above process.cwd(), which is always app/
//      Both `next dev/build` and `tsx` scripts run with cwd = app/.
const envPath = process.env.FUNNELS_DB_PATH;
const dbPath = envPath
  ? envPath
  : path.resolve(process.cwd(), '..', 'ksamata_funnels.db');

// Safety guard for the default path only: if the DB file doesn't exist we
// refuse to create an empty one — better-sqlite3 would silently do so otherwise.
if (!envPath && !fs.existsSync(dbPath)) {
  throw new Error(
    `Database not found at default path: ${dbPath}\n` +
    `Set FUNNELS_DB_PATH to the absolute path of the SQLite file, ` +
    `or ensure process.cwd() is the app/ directory.`
  );
}

// Singleton pattern — safe in Next.js dev (hot reload) because the module
// cache is shared within one Node process.
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;

/**
 * A looser type that covers both the full DB and a SQLiteTransaction.
 * Use this for helper functions that can be called inside a transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDB = BaseSQLiteDatabase<any, any, any, any>;
