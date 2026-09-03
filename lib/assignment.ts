import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { chooseOwner, shouldEscalate, type Candidate } from '@/core/assignment';

// The database half of feedback #18/#20/#21. The DECISIONS live in core/assignment.ts, pure
// and tested; this only fetches what they need and writes what they conclude.

/** Midnight IST of a given instant, as the UTC moment — the key RosterDay is stored under. */
export function istDayStart(at: Date): Date {
  const IST_OFFSET_MS = 5.5 * 3600_000;
  const shifted = new Date(at.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

async function candidatesFor(campusOrgUnitId: string): Promise<Candidate[]> {
  const staff = await db.staff.findMany({
    where: { OR: [{ scopeOrgUnitId: campusOrgUnitId }, { scopeOrgUnitId: 'group' }] },
    select: { id: true, name: true, scopeOrgUnitId: true, permissions: true, awayUntil: true },
  });
  return staff;
}

/**
 * Pick an owner for a freshly filed request, or return null with a reason.
 *
 * Called on filing rather than on arrival: an unfiled item has no category to route on, and
 * assigning before a human has looked would put a name against something nobody has read.
 */
export async function autoAssign(requestId: string, now = new Date()) {
  const req = await db.request.findUnique({
    where: { id: requestId },
    select: {
      id: true, campusOrgUnitId: true, category: true, suggestedCategory: true,
      aboutStaffIds: true, ownerId: true,
    },
  });
  if (!req || req.ownerId) return null;

  const onDate = istDayStart(now);
  const [roster, routes, candidates] = await Promise.all([
    db.rosterDay.findMany({
      where: { campusOrgUnitId: req.campusOrgUnitId, onDate },
      select: { staffId: true },
    }),
    db.categoryRoute.findMany({
      where: { campusOrgUnitId: req.campusOrgUnitId },
      select: { category: true, staffId: true },
    }),
    candidatesFor(req.campusOrgUnitId),
  ]);

  const decision = chooseOwner({
    campusOrgUnitId: req.campusOrgUnitId,
    category: req.category ?? req.suggestedCategory ?? null,
    onDutyIds: roster.map(r => r.staffId),
    routes: new Map(routes.map(r => [r.category, r.staffId])),
    candidates,
    aboutStaffIds: req.aboutStaffIds,
    now,
  });

  if (decision.ownerId) {
    await db.request.update({
      where: { id: req.id },
      data: { ownerId: decision.ownerId, ownerSetAt: now },
    });
  }

  // Recorded either way. "Why has nobody got this?" is as worth answering as "why me?".
  await db.activity.create({
    data: {
      id: randomUUID(), requestId: req.id, at: now,
      kind: decision.ownerId ? 'assigned' : 'note',
      detail: `Routed automatically. ${decision.reason}`,
    },
  });

  return decision;
}

/**
 * Return untouched work to the pool — the away flag and the timer, per feedback #20.
 *
 * Runs on the mailbox tick, which is the only thing here that wakes up on its own. Bounded to
 * a batch so one very stale queue cannot make a pass take minutes; the next tick continues.
 */
export async function escalateStale(now = new Date(), limit = 50) {
  const owned = await db.request.findMany({
    where: { ownerId: { not: null }, status: { in: ['open', 'waiting'] }, firstReplyAt: null },
    select: {
      id: true, ref: true, ownerId: true, ownerSetAt: true, firstReplyAt: true, urgency: true,
      owner: { select: { id: true, name: true, scopeOrgUnitId: true, permissions: true, awayUntil: true } },
    },
    take: limit,
  });

  let escalated = 0;
  for (const r of owned) {
    const d = shouldEscalate({
      ownerId: r.ownerId, ownerSetAt: r.ownerSetAt, firstReplyAt: r.firstReplyAt,
      urgency: r.urgency, owner: r.owner, now,
    });
    if (!d.escalate) continue;

    await db.request.update({
      where: { id: r.id },
      data: { ownerId: null, ownerSetAt: null },
    });
    await db.activity.create({
      data: {
        id: randomUUID(), requestId: r.id, at: now, kind: 'escalated',
        detail: d.reason,
      },
    });
    escalated++;
  }
  return { checked: owned.length, escalated };
}
