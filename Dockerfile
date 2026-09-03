# front-desk — production image (Railway, first deploy: a controlled testing phase, VK
# 2026-08-13 — a hand-picked few reviewers, real data, persona-switching deliberately still on
# ahead of real per-user auth; see BACKLOG.md).
#
# Mirrors career-counselling/exam-module's Dockerfile shape (node:20-bookworm-slim to match
# ci-front-desk.yml, standalone output, non-root runner, migrate deploy on boot) with ONE real
# simplification: no private-dependency build stage. front-desk vendors the design system's CSS
# in styles/fountainhead/ specifically to avoid a GITHUB_TOKEN at install (see front-desk/CLAUDE.md
# Stack section) — so `npm ci` needs nothing beyond the lockfile.
#
# No seed step on boot: this deploy's database is migrated in from local (real roster + phone
# imports + the real Gmail pull), not seeded fresh — see BACKLOG.md's deploy note. If a future
# redeploy ever needs the synthetic demo world instead, run prisma/seed.ts as a one-off, the same
# way career-counselling's own Dockerfile documents.
FROM node:20-bookworm-slim AS base

# openssl: Prisma's engines need it at runtime (debian-slim ships without it).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: prisma client + the standalone Next bundle ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Every DB-reading page is force-dynamic (verified before ci-front-desk.yml was added — every
# route already renders ƒ, none prerender), so the build never touches the database; this
# placeholder only satisfies Prisma client construction.
RUN export DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
  && npx prisma generate \
  && npm run build

# ---- runner: the published image — lean, non-root ----
FROM base AS runner
ENV NODE_ENV=production
# Bind all interfaces so Railway's proxy can reach the standalone server.
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# The Next standalone output + static assets. public/ (the layout board) is NOT bundled by
# standalone and must be copied explicitly.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# prisma/ + the FULL node_modules, not a hand-picked subset — `migrate deploy` on boot is the
# sole in-container Prisma CLI use, but Prisma 6's CLI has a transitive closure (effect, c12, …)
# the standalone trace prunes. Learned this the same way career-counselling's own Dockerfile
# documents having learned it: hand-picking node_modules/{prisma,@prisma} crashed on boot with
# "Cannot find module 'effect'" — reproduced locally before ever reaching Railway.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules ./node_modules

USER nextjs
EXPOSE 4200

# On every start: apply pending migrations (FATAL — a bad schema never serves), then start the
# standalone server on $PORT (Railway injects it; 4200 is the local fallback).
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && PORT=${PORT:-4200} node server.js"]
