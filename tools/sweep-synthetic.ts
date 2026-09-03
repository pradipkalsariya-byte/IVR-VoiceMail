// tools/sweep-synthetic.ts — remove the synthetic demo remnants from a database that now
// holds real mail (VK's call, 24-Aug-2026, ahead of the team demo).
//
// Run: npx tsx tools/sweep-synthetic.ts             preview
//      npx tsx tools/sweep-synthetic.ts --apply     deletes
//
// The production database began life as a migrated copy of the local dev world, so seeded
// fixtures ("Family 07", "A Child", FSK2099999) sit beside real parent mail. This sweep
// removes exactly the synthetic rows, BY PROVENANCE MARKERS rather than by content:
//
//   R1 — seeded requests: seed ids match ^r-\d+$ (prisma/seed.ts's own pattern); every
//        live-created request has a UUID. Content can look real; ids cannot lie.
//   R2 — demo-source pulls: sourceMessageId '<demo-…' / '<app-fixture-…' (lib/ingest/fake.ts's
//        stable fixture ids).
//   R3 — synthetic families: emailKey @example.test (the seed's reserved domain), deleted only
//        once no surviving request references them.
//   R4 — ledger rows for demo-shaped messageIds (their requests go under R2; ledger rows are
//        SetNull on request delete and would otherwise linger as orphaned fixtures).
//
// STAFF ROWS ARE DELIBERATELY KEPT: the pilot's persona switcher runs on them until the
// Google sign-in roles replace it. Clusters are recomputed afterwards over what survives.
// Requests cascade their messages, activities and chases (schema onDelete).

import { PrismaClient } from '@prisma/client';
import { detectClusters } from '../core/coordination';

const APPLY = process.argv.includes('--apply');
const db = new PrismaClient();

async function main() {
  console.log(APPLY ? 'APPLY MODE — deleting.' : 'Preview only — run with --apply to delete.\n');

  const all = await db.request.findMany({
    select: { id: true, ref: true, subject: true, channel: true, sourceMessageId: true, familyId: true },
  });
  const seedIdRe = /^r-\d+$/;
  const demoMsgRe = /^<(demo-|app-fixture-)/;

  const r1 = all.filter(r => seedIdRe.test(r.id));
  const r2 = all.filter(r => !seedIdRe.test(r.id) && demoMsgRe.test(r.sourceMessageId ?? ''));
  const doomed = [...r1, ...r2];

  console.log(`R1 seeded requests: ${r1.length}`);
  for (const r of r1) console.log(`  ${r.ref}  [${r.channel}]  ${r.subject.slice(0, 70)}`);
  console.log(`\nR2 demo-source requests: ${r2.length}`);
  for (const r of r2) console.log(`  ${r.ref}  [${r.channel}]  ${r.subject.slice(0, 70)}`);

  const synthFamilies = await db.family.findMany({
    where: { emailKey: { endsWith: '@example.test' } },
    select: { id: true, label: true, emailKey: true, _count: { select: { requests: true } } },
  });
  const doomedIds = new Set(doomed.map(r => r.id));
  const familiesSafe = synthFamilies.filter(f => {
    const survivors = all.filter(r => r.familyId === f.id && !doomedIds.has(r.id));
    return survivors.length === 0;
  });
  const familiesHeld = synthFamilies.filter(f => !familiesSafe.includes(f));
  console.log(`\nR3 synthetic families to delete: ${familiesSafe.length}`);
  if (familiesHeld.length) {
    console.log(`  HELD (still referenced by a surviving request — investigate before deleting): ${familiesHeld.map(f => f.label).join(', ')}`);
  }

  const ledgerRows = await db.mailLedgerEntry.findMany({
    where: { OR: [{ messageId: { startsWith: '<demo-' } }, { messageId: { startsWith: '<app-fixture-' } }] },
    select: { id: true, messageId: true, subject: true },
  });
  console.log(`\nR4 demo-shaped ledger rows: ${ledgerRows.length}`);

  const realSurvivors = all.length - doomed.length;
  console.log(`\nSurviving (real) requests after sweep: ${realSurvivors}`);

  if (!APPLY) {
    console.log('\nPreview only. Nothing deleted.');
    return;
  }

  // Requests first (cascades messages/activities/chases; ledger links SetNull), then the
  // fixture ledger rows, then the now-unreferenced families (FamilyPhone cascades).
  const delReq = await db.request.deleteMany({ where: { id: { in: doomed.map(r => r.id) } } });
  const delLedger = await db.mailLedgerEntry.deleteMany({ where: { id: { in: ledgerRows.map(l => l.id) } } });
  const delFam = await db.family.deleteMany({ where: { id: { in: familiesSafe.map(f => f.id) } } });
  console.log(`\nDeleted: ${delReq.count} requests, ${delLedger.count} ledger rows, ${delFam.count} families.`);

  // Recompute coordination over what survives — a cluster whose members went with the seed
  // must not keep a banner alive.
  // Candidate shape must match recomputeClustersDb in lib/clusters.ts ('server-only', so it
  // cannot be imported here) — otherwise a sweep leaves the estate clustered differently to
  // the way the next mailbox tick would cluster it.
  const rows = await db.request.findMany({
    where: { isVendorNoise: false, isSwitchboard: false, status: { not: 'not_a_request' } },
    select: {
      id: true, subject: true, arrivedAt: true, campusOrgUnitId: true,
      category: true, suggestedCategory: true, familyId: true, senderEmail: true,
    },
  });
  const found = detectClusters(rows.map(r => ({
    id: r.id, subject: r.subject, arrivedAt: r.arrivedAt,
    campusOrgUnitId: r.campusOrgUnitId, category: r.category ?? r.suggestedCategory,
    originatorKey: r.familyId ?? (r.senderEmail ? r.senderEmail.toLowerCase() : null),
  })));
  await db.request.updateMany({ data: { clusterId: null } });
  await db.cluster.deleteMany();
  for (const [i, c] of found.entries()) {
    const id = `cl-${i + 1}`;
    await db.cluster.create({
      data: {
        id, label: c.label, signature: c.signature,
        windowStart: c.windowStart, windowEnd: c.windowEnd,
        isCoordinated: c.isCoordinated, templateHits: c.templateHits,
        campusOrgUnitId: rows.find(r => r.id === c.memberIds[0])?.campusOrgUnitId ?? null,
      },
    });
    await db.request.updateMany({ where: { id: { in: c.memberIds } }, data: { clusterId: id } });
  }
  console.log(`Clusters recomputed: ${found.length}.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
