// core/cluster-actions.ts — acting on a cluster WITHOUT collapsing its members (QM-D19).
//
// PURE. No I/O, no Prisma, no Next imports. Timestamps are the caller's problem — a plan
// describes intent, and the server action stamps `now` when it applies it.
//
// The ruling this encodes: 53% of live student filings are group submissions, and QM-D19
// (2026-08-07) settled how they are handled. The RECORD stays the atom — a cluster is a lens
// over per-person records, never a super-record. So a cluster action fans out into one
// per-member effect each, with its OWN Activity row, and each member keeps its own status and
// its own satisfaction. Answering "once, publicly" (the 7 July 2026 lesson) must not mean one
// family's record silently swallowing twelve others.
//
// Two invariants are structural here, not just tested:
//
//  1. `MemberUpdate` cannot express a satisfaction write. Satisfaction is the complainant's
//     OWN rating (QM-D18) — it comes from outside the school, per person. A bulk action that
//     set it would be the school rating itself thirteen times.
//  2. A member whose status makes the action a no-op is returned in `skipped` WITH a reason,
//     never silently modified and never silently dropped. The confirmation screen shows the
//     skipped names before anything is written — a bulk action you cannot preview is a bulk
//     action someone will regret.

export type ClusterActionKind = 'note' | 'resolve' | 'assign';

export interface ClusterMemberInput {
  id: string;
  /** FD-0001 — quoted in skip reasons so a human can find the record. */
  ref: string;
  /** unfiled | open | waiting | resolved | not_a_request (core/taxonomy.ts STATUSES). */
  status: string;
  ownerId?: string | null;
  familyId?: string | null;
  /** Staff this complaint is ABOUT (QM-D33). guardCluster's select supplies it — a bulk
   *  assign must skip these members for the named person (QM-D32), or the cluster becomes
   *  the one door through which they can end up owning the complaint about them. */
  aboutStaffIds?: readonly string[];
}

/**
 * The only fields a cluster action may touch on a member. Deliberately narrow: no
 * `satisfaction`, no `satisfactionAbsentReason` (QM-D18 — individual, always), no category or
 * urgency (triage is per-record, QM-D10), no clusterId (membership is confirmed by a human
 * elsewhere — QM-D19 consequence 2: the detector PROPOSES, it never enrols).
 */
export interface MemberUpdate {
  status?: 'resolved';
  /** Caller stamps `resolvedAt = now`; the pure plan only says it must be set. */
  setResolvedAt?: boolean;
  ownerId?: string;
}

export interface MemberEffect {
  memberId: string;
  ref: string;
  /** Empty object for a note — a note is trail, not state. */
  update: MemberUpdate;
  /** Every member gets its OWN Activity (the record is the atom, QM-D19). */
  activity: { kind: 'note' | 'assigned' | 'resolved'; detail: string };
}

export interface SkippedMember {
  memberId: string;
  ref: string;
  /** Plain language, shown on the confirmation screen. */
  reason: string;
}

export interface ClusterActionPlan {
  action: ClusterActionKind;
  apply: MemberEffect[];
  skipped: SkippedMember[];
}

export interface PlanArgs {
  action: ClusterActionKind;
  /** Shown in every Activity detail — the trail must say the write came via the cluster. */
  clusterLabel: string;
  members: readonly ClusterMemberInput[];
  /** Required for 'note'; optional colour for 'resolve'. */
  note?: string;
  /** Required for 'assign'. The name goes into the trail, so pass the display name. */
  assignee?: { id: string; name: string };
}

/**
 * Turn "do X to this cluster" into per-member effects. Deterministic: same inputs, same plan.
 *
 * Skip rules, per action — each one is a judgement, so the WHY is recorded here:
 *
 *  - `not_a_request` members are skipped by EVERY action. That status is a ruling ("kept on
 *    record, out of the working queue") and a cluster write would drag the record back into a
 *    story it was ruled out of.
 *  - resolve skips `resolved` (a second resolution is a no-op that would still spam the trail)
 *    and `unfiled` (QM-D10: a record leaves the queue through the triage gate, not around it —
 *    bulk-resolving an untriaged record would bury it with no category and no filing decision).
 *  - assign skips `resolved` (nothing left to hand over) and members already owned by the
 *    assignee (a no-op reassignment fakes activity on a record nobody touched).
 *  - note skips ONLY `not_a_request`. A note is annotation, not a state change — a member
 *    resolved individually yesterday still benefits from "answered publicly on the 8th" landing
 *    in its trail, and an unfiled member is not moved through any gate by being annotated.
 */
export function planClusterAction(args: PlanArgs): ClusterActionPlan {
  const { action, clusterLabel, members } = args;
  const note = (args.note ?? '').trim();

  if (action === 'note' && !note) {
    throw new Error('A cluster note needs some text.');
  }
  if (action === 'assign' && !args.assignee) {
    throw new Error('A cluster assignment needs someone to assign to.');
  }

  const apply: MemberEffect[] = [];
  const skipped: SkippedMember[] = [];
  const via = `via cluster "${clusterLabel}"`;

  for (const m of members) {
    if (m.status === 'not_a_request') {
      skipped.push({
        memberId: m.id, ref: m.ref,
        reason: `${m.ref} was ruled not a request — kept on record, outside the working queue.`,
      });
      continue;
    }

    if (action === 'note') {
      apply.push({
        memberId: m.id, ref: m.ref,
        update: {},
        activity: { kind: 'note', detail: `${note} (${via})` },
      });
      continue;
    }

    if (action === 'resolve') {
      if (m.status === 'resolved') {
        skipped.push({ memberId: m.id, ref: m.ref, reason: `${m.ref} is already resolved.` });
        continue;
      }
      if (m.status === 'unfiled') {
        skipped.push({
          memberId: m.id, ref: m.ref,
          reason: `${m.ref} has not been filed yet — triage it first (QM-D10: nothing leaves the queue around the gate).`,
        });
        continue;
      }
      apply.push({
        memberId: m.id, ref: m.ref,
        update: { status: 'resolved', setResolvedAt: true },
        activity: {
          kind: 'resolved',
          detail: `Resolved ${via}${note ? ` — ${note}` : ' — answered once for the whole group.'}`,
        },
      });
      continue;
    }

    // action === 'assign'
    const assignee = args.assignee!;
    if (m.status === 'resolved') {
      skipped.push({ memberId: m.id, ref: m.ref, reason: `${m.ref} is already resolved — nothing left to hand over.` });
      continue;
    }
    // The same identity rule single-request assign enforces via assignableOwner (QM-D32):
    // a complaint about a person is never their work item, and a bulk hand-over is exactly
    // where that rule would otherwise slip through.
    if ((m.aboutStaffIds ?? []).includes(assignee.id)) {
      skipped.push({
        memberId: m.id, ref: m.ref,
        reason: `${m.ref} concerns ${assignee.name} — a complaint about a person is never their work item (QM-D32).`,
      });
      continue;
    }
    if (m.ownerId === assignee.id) {
      skipped.push({ memberId: m.id, ref: m.ref, reason: `${m.ref} is already owned by ${assignee.name}.` });
      continue;
    }
    apply.push({
      memberId: m.id, ref: m.ref,
      update: { ownerId: assignee.id },
      activity: { kind: 'assigned', detail: `Owner set to ${assignee.name} (${via}).` },
    });
  }

  return { action, apply, skipped };
}

/**
 * QM-D19's binding counting rule: a cluster is ONE issue raised by N complainants — never N
 * issues. Reporting that says "thirteen complaints" when one circulated template arrived
 * thirteen times is how 7 July 2026 read as chaos instead of one decision to answer.
 *
 * Complainants are DISTINCT families. Two messages from the same family are one complainant;
 * members with no identified family each count as one (two unidentified senders are presumed
 * distinct — merging them would undercount the people waiting on an answer).
 */
export function clusterStats(
  members: readonly { id: string; familyId?: string | null }[],
): { issues: number; complainants: number } {
  if (members.length === 0) return { issues: 0, complainants: 0 };
  const families = new Set<string>();
  let unidentified = 0;
  for (const m of members) {
    if (m.familyId) families.add(m.familyId);
    else unidentified += 1;
  }
  return { issues: 1, complainants: families.size + unidentified };
}
