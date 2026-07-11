# Development Notes

## Local Setup

Run application commands from `app/`:

```sh
npm install
npm run dev
```

Useful checks:

```sh
npx tsc --noEmit
npx vitest run
npm run build
```

## Database Contract

The active development database is `ksamata_funnels.db` in the repository root. This is intentional for now:

- tests copy `../ksamata_funnels.db` from inside `app/`;
- legacy Python data tools mutate the root database;
- Docker seed refreshes are based on this database after migrations and WAL checkpointing.

Set `FUNNELS_DB_PATH` to point the app or Docker runner at another database.

## WAL Gotcha

SQLite can keep recent writes in `ksamata_funnels.db-wal` while a dev server is running. Before copying the DB to `app/seed/` or making a backup:

1. Stop the running app process.
2. Run a checkpoint, for example:

   ```sh
   sqlite3 ksamata_funnels.db 'PRAGMA wal_checkpoint(TRUNCATE);'
   ```

3. Verify expected tables/counts against the main `.db`.

## Data Tools

- Import/mutation tools live in `tools/data-import/`.
- Export tools live in `tools/data-export/`.
- Source workbooks live in `data/source/`.
- Generated workbook exports live in `data/generated/`.

The tools resolve the repository root from their own file location, so they can be run from any current working directory.

## Deployment

See `app/DEPLOY.md`. The container expects a persistent volume at `/data` and `FUNNELS_DB_PATH=/data/ksamata_funnels.db`.
