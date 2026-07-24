import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';

type DrizzleHandle = BetterSQLite3Database<typeof schema>;

interface DbSingleton {
  sqlite: Database.Database;
  drizzle: DrizzleHandle;
}

// Слот на globalThis, а не модульная переменная: webpack собирает этот модуль
// в несколько копий (граф instrumentation.ts и граф route-хендлеров — разные
// чанки), и модульный синглтон дал бы два better-sqlite3-соединения к одному
// файлу. globalThis один на процесс, поэтому копии модуля делят соединение.
declare global {
  // eslint-disable-next-line no-var
  var __ksamataFunnelsDb: DbSingleton | undefined;
}

function createSingleton(): DbSingleton {
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

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  return { sqlite, drizzle: drizzle(sqlite, { schema }) };
}

// Соединение и прагмы выполняются ровно один раз — на той копии модуля,
// которая первой добралась до слота. Остальные переиспользуют её результат.
function getSingleton(): DbSingleton {
  if (!globalThis.__ksamataFunnelsDb) {
    globalThis.__ksamataFunnelsDb = createSingleton();
  }
  return globalThis.__ksamataFunnelsDb;
}

export const db: DrizzleHandle = getSingleton().drizzle;

export type DB = typeof db;

/**
 * A looser type that covers both the full DB and a SQLiteTransaction.
 * Use this for helper functions that can be called inside a transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDB = BaseSQLiteDatabase<any, any, any, any>;
