import type { Config } from 'drizzle-kit';
import path from 'path';

const dbPath = process.env.FUNNELS_DB_PATH
  ? process.env.FUNNELS_DB_PATH
  : path.resolve(__dirname, '..', 'ksamata_funnels.db');

export default {
  schema: './src/db/schema.ts',
  out:    './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
} satisfies Config;
