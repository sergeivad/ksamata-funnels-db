/**
 * Standalone legacy tag-override backfill for the Docker runner image.
 * Compiled to backfill-legacy-tag-overrides.cjs via esbuild in the builder stage:
 *   npx esbuild scripts/backfill-legacy-tag-overrides-runner.ts \
 *     --bundle --platform=node --external:better-sqlite3 --outfile=backfill-legacy-tag-overrides.cjs
 * Invoked by docker-entrypoint.sh as: node /app/backfill-legacy-tag-overrides.cjs
 * Must run AFTER migrate-phase5.cjs (needs the seeded template).
 */

import Database from 'better-sqlite3';
import { backfillLegacyTagOverrides } from './backfill-legacy-tag-overrides';

const dbPath = process.env.FUNNELS_DB_PATH;
if (!dbPath) {
  console.error('[backfill-legacy-tag-overrides] FUNNELS_DB_PATH is not set — skipping.');
  process.exit(0);
}

console.log(`[backfill-legacy-tag-overrides] Running backfill on: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
backfillLegacyTagOverrides(sqlite);
sqlite.close();
console.log('[backfill-legacy-tag-overrides] Done.');
