'use server';

// Cluster actions (QM-D19) — apply one human decision to every confirmed member, as
// per-member writes. Kept OUT of app/actions.ts on purpose: that file is shared surface for
// the clocks and permissions work, and these three actions are a self-contained unit.
//
// Membership rule (QM-D19 consequence 2): the detector PROPOSES, a human confirms — so these
// actions only ever touch requests ALREADY linked to the cluster (`clusterId` set by
// recomputeClusters). Nothing here searches for lookalike requests and enrols them.

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { can } from '@/core/permissions';
import { planClusterAction, type ClusterActionPlan } from '@/core/cluster-actions';

const bump = () => {
  revalidatePath('/');
  revalidatePath('/patterns');
  revalidatePath('/oversight');
};

/**
 * Actor from the SERVER session (never a form field), capability from the actor's grants,
 * scope checked against every member. A bulk write is exactly where a scope hole would do the
 * most damage, so the whole action is refused if even one member sits outside the actor's
 * subtree — knowing a cluster id is not permission to write its members (R3-14).
 */
async function guardCluster(clusterId: string) {
  const actor = await currentActor();

  // Capability, not role: per the 2026-08-07 permissions ruling (see Staff.permissions in
  // schema.prisma), `isLeadership` is deprecated as an access check. 'assign' is the grant
  // that covers acting on requests in bulk; the seed's permission sets hand it out. Fails
  // closed: an actor with no grants sees the cluster but cannot act on it. Checked through
  // can() (QM-D9/D26) so 'oversight' implies it — the same seam single-request assign uses.
  const gate = can(actor, 'assign');
  if (!gate.allowed) throw new Error(gate.reason);

  const cluster = await db.cluster.findUnique({
    where: { id: clusterId },
    include: {
      requests: {
        select: {
          id: true, ref: true, status: true, ownerId: true, campusOrgUnitId: true,
          aboutStaffIds: true,
        },
        orderBy: { arrivedAt: 'asc' },
      },
    },
  });
  if (!cluster) throw new Error('Cluster not found.');

  const allowed = await visibleCampusIds(actor);
  for (const m of cluster.requests) {
    if (!allowed.includes(m.campusOrgUnitId)) {
      throw new Error('This cluster includes requests outside your scope.');
    }
    // Audience exclusion (QM-D33), wholesale — the same shape as the scope refusal above.
    // A member concerning the actor is closed to them entirely, and a bulk action is still
    // acting on it; the per-request pages suppress the row, so the cluster id is the one
    // handle through which they could still reach it.
    if (m.aboutStaffIds.includes(actor.id)) {
      throw new Error(
        'This cluster includes a complaint that concerns you, so it is closed to you ' +
          '(QM-D33) — ask a colleague to act on the group.',
      );
    }
  }
  return { actor, cluster };
}

/**
 * Apply a pure plan in ONE transaction — all members or none. A half-applied cluster action
 * would recreate the exact 7 July failure mode (some families answered, some not) with the
 * system's own fingerprints on it.
 *
 * NOTE what is never written here: `satisfaction` / `satisfactionAbsentReason`. The plan's
 * `MemberUpdate` type cannot express them (QM-D18 — the rating is the complainant's own, per
 * person), and this mapper only reads the three fields the type allows.
 */
async function applyPlan(plan: ClusterActionPlan, actorId: string) {
  const now = new Date();
  const ops = [];
  for (const e of plan.apply) {
    const data: { status?: string; resolvedAt?: Date; ownerId?: string } = {};
    if (e.update.status) data.status = e.update.status;
    if (e.update.setResolvedAt) data.resolvedAt = now;
    if (e.update.ownerId !== undefined) data.ownerId = e.update.ownerId;
    if (Object.keys(data).length > 0) {
      ops.push(db.request.update({ where: { id: e.memberId }, data }));
    }
    // One Activity per member — the record is the atom (QM-D19), so the trail lands on each
    // member's own record, not on some cluster-level ledger nobody reads from a request page.
    ops.push(db.activity.create({
      data: {
        id: randomUUID(), requestId: e.memberId, actorId, at: now,
        kind: e.activity.kind, detail: e.activity.detail,
      },
    }));
  }
  if (ops.length > 0) await db.$transaction(ops);
  return { applied: plan.apply.length, skipped: plan.skipped.length };
}

/** Add the same note to every member's trail. Skips are reported, never silent. */
export async function clusterNote(clusterId: string, note: string) {
  const { actor, cluster } = await guardCluster(clusterId);
  const plan = planClusterAction({
    action: 'note', clusterLabel: cluster.label, members: cluster.requests, note,
  });
  const summary = await applyPlan(plan, actor.id);
  bump();
  return summary;
}

/** Hand every live member to one owner — the "one clear public answer" needs one hand. */
export async function clusterAssign(clusterId: string, staffId: string) {
  const { actor, cluster } = await guardCluster(clusterId);
  const assignee = await db.staff.findUnique({ where: { id: staffId } });
  if (!assignee) throw new Error('That person is not in the directory.');
  const plan = planClusterAction({
    action: 'assign', clusterLabel: cluster.label, members: cluster.requests,
    assignee: { id: assignee.id, name: assignee.name },
  });
  const summary = await applyPlan(plan, actor.id);
  bump();
  return summary;
}

/**
 * Resolve every live member. Satisfaction is untouched — each family gets asked
 * individually through the per-request closure flow (QM-D18), because thirteen families
 * were not all satisfied just because one answer went out.
 */
export async function clusterResolve(clusterId: string, resolutionNote: string) {
  const { actor, cluster } = await guardCluster(clusterId);
  const plan = planClusterAction({
    action: 'resolve', clusterLabel: cluster.label, members: cluster.requests,
    note: resolutionNote,
  });
  const summary = await applyPlan(plan, actor.id);
  bump();
  return summary;
}
