import 'server-only';
import { db } from '@/lib/db';
import { detectClusters } from '@/core/coordination';

/**
 * Re-run coordination detection over everything currently in play. Extracted from the
 * recomputeClusters server action (2026-08-24) so the five-minute mailbox tick can call it
 * too: the action wraps this and then revalidates paths — which the tick MUST NOT do, because
 * revalidatePath outside a request context throws, and a throw inside the timer would read as
 * "mailbox down" when the mailbox was fine.
 */
export async function recomputeClustersDb(): Promise<void> {
  const rows = await db.request.findMany({
    // Switchboard slips are excluded outright (2026-08-25). A callback slip records only that
    // a line rang unanswered — it has no subject-matter yet ("call back, then file what it was
    // actually about"), so there is nothing for it to coordinate ON. Including them put seven
    // phantom "Looks coordinated" cards at the top of the live queue, every one of them a
    // single number redialling. detectClusters' distinct-originator rule would now catch most
    // of that anyway; this keeps them out of the candidate set to begin with.
    where: { isVendorNoise: false, isSwitchboard: false, status: { not: 'not_a_request' } },
    select: {
      id: true, subject: true, arrivedAt: true, campusOrgUnitId: true,
      category: true, suggestedCategory: true, familyId: true, senderEmail: true,
    },
  });

  const found = detectClusters(rows.map(r => ({
    id: r.id, subject: r.subject, arrivedAt: r.arrivedAt,
    campusOrgUnitId: r.campusOrgUnitId, category: r.category ?? r.suggestedCategory,
    // Family first: one household writing from two addresses is still one complainant.
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
}
