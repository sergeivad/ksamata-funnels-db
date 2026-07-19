# Deployment — Dokploy

## Build

- **Build context:** `app/` (this directory)
- **Dockerfile:** `app/Dockerfile`

Dokploy builds the image directly from the Git repo. Point the build context at `app/`.

## Environment variables

| Variable | Value |
|---|---|
| `FUNNELS_DB_PATH` | `/data/ksamata_funnels.db` |
| `NODE_ENV` | `production` (set in Dockerfile) |
| `ADMIN_BASIC_AUTH` | `login:password` — **required in production**: without it every request gets 503 (fail-closed) |
| `ADMIN_AUTH_DISABLED` | `true` turns auth OFF everywhere (overrides `ADMIN_BASIC_AUTH` and the production fail-closed). ⚠️ makes the admin publicly reachable. Remove to restore auth. |

## Persistent volume

Mount a persistent volume at `/data` inside the container.

- On **first start** the entrypoint (`docker-entrypoint.sh`) detects that `/data/ksamata_funnels.db` is absent and copies the baked-in seed database from `/app/seed/ksamata_funnels.db`.
- On **subsequent starts** the file already exists — the copy is skipped and existing data is preserved.

## Migrations on start

After the seed check, the entrypoint runs the idempotent migration chain on
**every** start, in order:

1. `migrate-phase2.cjs` — `channels`/`directions` tables + funnel columns
2. `migrate-phase3.cjs` — `funnel_blocks`/`funnel_block_items` + one-time content move
3. `migrate-phase4.cjs` — `funnels.rooms_enabled` + backfill
4. `migrate-phase5.cjs` — `tag_templates` + `funnel_tag_overrides` + template seed
5. `backfill-legacy-tag-overrides.cjs` — preserves legacy non-AV tags as overrides

All steps are marker-gated or `IF NOT EXISTS`, so re-running them is safe.

> This seed + migration flow runs only for the **production** image
> (`app/Dockerfile` → `docker-entrypoint.sh`). The root `docker-compose.yml` dev
> stack uses `Dockerfile.dev`, skips the entrypoint, and mounts the real repo DB
> directly.

## Port

The container listens on **port 3000** (Next.js standalone server). Map it to whatever external port you need in Dokploy.

## Quick local test

```sh
docker build -t funnels-admin .           # run from app/
docker run --rm -d -p 3001:3000 \
  -e FUNNELS_DB_PATH=/data/ksamata_funnels.db \
  -v funnels_data:/data \
  --name funnels_test funnels-admin

curl -s localhost:3001/api/funnels | head -c 300
docker stop funnels_test
docker volume rm funnels_data
```
