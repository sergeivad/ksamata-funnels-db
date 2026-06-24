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

# Copy and make the entrypoint executable
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
