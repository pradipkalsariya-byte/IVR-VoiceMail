'use server';

// The QM-D31 claim: an unowned queue item becomes a personal item the moment someone takes
// it — at which point the queue target becomes its target, unchanged. Kept out of
// app/actions.ts for the same reason cluster-actions.ts is: that file is shared surface,
// and this action is a self-contained unit.

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { currentActor } from '@/lib/session';
import { can } from '@/core/permissions';
import { CLAIM_RACE_REASON, claimDecision } from '@/core/work-list';

/**
 * The actor claims for THEMSELF only. There is deliberately no target parameter, so
 * claim-for-someone-else is impossible by SIGNATURE — which is exactly why this is not
 * assign(): handing work to another person is a leadership act with an identity rule on its
 * target (QM-D32, assignableOwner), while pulling work onto yourself has no target to
 * check. The actor comes from the server session (cardinal rule 5), so the only person a
 * claim can ever land on is the person pressing the button.
 *
 * Rides 'file', not 'assign', through can(): front-line claiming must not need the
 * leadership 'assign' grant — a pool the desk cannot pull from is just an unowned queue
 * with a better name. That is the point of a pool.
 */
export async function claim(requestId: string) {
  const actor = await currentActor();
  const req = await db.request.findUnique({ where: { id: requestId } });
  if (!req) throw new Error('Request not found.');

  // The guard idiom (app/actions.ts): capability, scope, the named safeguarding grant
  // (R3-4) and the QM-D33 audience exclusion in one can() seam. Scope is checked on this
  // WRITE even though the pool page already scoped its read — knowing a reference is not
  // permission (R3-14), and a claim reached by hand-carrying an out-of-scope id must
  // refuse exactly like the page would never have offered it.
  const decision = can(actor, 'file', {
    campusOrgUnitId: req.campusOrgUnitId,
    isSafeguarding: req.isSafeguarding,
    isOwnedByActor: req.ownerId === actor.id,
    isAboutActor: req.aboutStaffIds.includes(actor.id),
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const claimable = claimDecision(req);
  if (!claimable.allowed) throw new Error(claimable.reason);

  // Read-check-write: the WHERE clause is the lock. Two people can pass the pure check
  // above in the same instant; only one write can match `ownerId: null`, so the loser
  // matches zero rows instead of silently overwriting the winner's claim.
  // status is in the WHERE too: resolve() and markNotARequest() never set an owner, so in
  // the window after the pure check a concurrent close would still match `ownerId: null` —
  // and a claimed closed item would be invisible ownership (no personal bucket shows those
  // statuses). Both halves of claimDecision are enforced atomically or not at all.
  const { count } = await db.request.updateMany({
    where: { id: requestId, ownerId: null, status: { in: ['open', 'waiting'] } },
    // ownerSetAt starts the escalation clock (feedback #20): claiming something and then not
    // acting on it is exactly the case the timer exists to catch.
    data: { ownerId: actor.id, ownerSetAt: new Date() },
  });
  if (count === 0) throw new Error(CLAIM_RACE_REASON);

  await db.activity.create({
    data: {
      id: randomUUID(),
      requestId,
      actorId: actor.id,
      at: new Date(),
      kind: 'assigned',
      detail: `Claimed from the pool by ${actor.name} — its queue target rides along (QM-D31).`,
    },
  });

  revalidatePath('/');
  revalidatePath('/my');
  revalidatePath('/oversight');
  revalidatePath(`/r/${req.ref}`);
}
