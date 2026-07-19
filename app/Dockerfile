# ──────────────────────────────────────────────
# Stage 1: builder
# Needs build toolchain to compile better-sqlite3 native module
# ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /build

# Install native build tools required by better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first (layer cache)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDeps needed for next build)
RUN npm ci

# Copy the rest of the source
COPY . .

# Make the seed DB available at build time so Next.js static generation
# can connect to the DB when it pre-renders pages.
ENV FUNNELS_DB_PATH=/build/seed/ksamata_funnels.db

# Build Next.js in standalone mode
RUN npm run build

# Compile the Phase-2 migration to a self-contained CJS bundle.
# better-sqlite3 is kept external so the runner's native .node binary is used.
RUN npx esbuild scripts/migrate-phase2-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase2.cjs

# Compile the Phase-3 migration to a self-contained CJS bundle.
# better-sqlite3 is kept external so the runner's native .node binary is used.
RUN npx esbuild scripts/migrate-phase3-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase3.cjs

# Compile the Phase-5 migration to a self-contained CJS bundle.
# better-sqlite3 is kept external so the runner's native .node binary is used.
RUN npx esbuild scripts/migrate-phase5-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=migrate-phase5.cjs

# Compile the legacy tag-override backfill to a self-contained CJS bundle.
# better-sqlite3 is kept external so the runner's native .node binary is used.
RUN npx esbuild scripts/backfill-legacy-tag-overrides-runner.ts \
      --bundle \
      --platform=node \
      --external:better-sqlite3 \
      --outfile=backfill-legacy-tag-overrides.cjs

# ──────────────────────────────────────────────
# Stage 2: runner
# ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Copy the standalone Next.js output
COPY --from=builder /build/.next/standalone ./

# Copy static assets into the right place inside standalone
COPY --from=builder /build/.next/static ./.next/static

# better-sqlite3 native module: Next.js standalone tracing usually includes
# the JS wrapper but may miss the compiled .node binary. Copy the full
# better-sqlite3 build directory explicitly so it is always present.
COPY --from=builder /build/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# Bake the seed database into the image (used by entrypoint on first run)
RUN mkdir -p /app/seed
COPY --from=builder /build/seed/ksamata_funnels.db /app/seed/ksamata_funnels.db

# Copy the compiled Phase-2 migration bundle into the runner image.
# It runs as a plain Node script using better-sqlite3 from /app/node_modules.
COPY --from=builder /build/migrate-phase2.cjs /app/migrate-phase2.cjs

# Copy the compiled Phase-3 migration bundle into the runner image.
COPY --from=builder /build/migrate-phase3.cjs /app/migrate-phase3.cjs

# Copy the compiled Phase-5 migration bundle into the runner image.
COPY --from=builder /build/migrate-phase5.cjs /app/migrate-phase5.cjs

# Copy the compiled legacy tag-override backfill bundle into the runner image.
COPY --from=builder /build/backfill-legacy-tag-overrides.cjs /app/backfill-legacy-tag-overrides.cjs

# Copy and make the entrypoint executable
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
