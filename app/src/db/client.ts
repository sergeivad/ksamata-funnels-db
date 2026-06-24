import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import * as schema from './schema';

// Resolve DB path: env FUNNELS_DB_PATH, or default relative to app/ dir
const dbPath = process.env.FUNNELS_DB_PATH
  ? process.env.FUNNELS_DB_PATH
  : path.resolve(__dirname, '../../..', 'ksamata_funnels.db');

// Singleton pattern — safe in Next.js dev (hot reload) because the module
// cache is shared within one Node process.
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
