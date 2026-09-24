#!/bin/sh
# Runs on every container boot: migrations always, the synthetic seed only when the database
# is genuinely empty (first boot). This replaces a manual "run npm run seed once" step that
# had no reliable way to be run against THIS specific deploy from outside Railway's own
# dashboard — baking the check into boot means it can never be skipped or run against the
# wrong database by mistake.
#
# Safe to leave in permanently: prisma/seed.ts clears-then-recreates, so it is idempotent, but
# the count check below means it only actually SEEDS on a database with zero org units — a
# later redeploy once real data exists never touches it.
set -e

node node_modules/prisma/build/index.js migrate deploy

NEEDS_SEED=$(node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.orgUnit.count()
  .then((n) => { console.log(n === 0 ? 'yes' : 'no'); return db.\$disconnect(); })
  .catch(() => { console.log('no'); });
")

if [ "$NEEDS_SEED" = "yes" ]; then
  echo "No org tree found — running the synthetic seed (first boot only)."
  npx tsx prisma/seed.ts
fi

PORT=${PORT:-4200} exec node server.js
