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
