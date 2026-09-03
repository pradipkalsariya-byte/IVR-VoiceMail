// core/work-list.ts — what front-desk contributes to a personal work surface: the seven-field
// row (QM-D29/QM-D30) and the claimable pool (QM-D31).
//
// PURE. No I/O, no Prisma, no Next imports, deterministic — same contract as the rest of
// core/. In the prototype the only consumer is the My-work page's claimable section, but the
// row is built HERE so the wire shape and the suppression rule port into the estate-wide
// aggregator unchanged: the module that owns the record is the module that decides what a
// row may carry.

import type { Decision } from './permissions';

/**
 * QM-D29: the contributed row carries EXACTLY seven fields — owning module, record
 * identifier, title, owner, due target, priority, item type/tag — and nothing else. Still
 * excluded, permanently: the narrative, the complaint detail, comments, attachments. A row
 * is a pointer plus enough to place it in a list — nothing more.
 *
 * Note what is NOT here: a sensitivity tier. Sensitivity is an INPUT to the server-side
 * filter (contributedRow returns null), never a field sent to the client — a tier on the
 * wire would itself be a hint, which is exactly what R3-19 forbids.
 */
export interface ContributedRow {
  module: 'front-desk';
  ref: string;
  title: string;
  /** Null when unowned — which on the claimable surface is every row, by construction. */
  ownerName: string | null;
  /** QM-D31: for an unowned item this IS the queue's target, inherited unchanged. */
  dueTarget: Date | null;
  priority: string;
  /** The confirmed category; null while untriaged — a missing tag, not an invented one. */
  itemType: string | null;
}

/**
 * What building a row needs to know. A Prisma request satisfies everything except
 * `ownerName`, which the caller resolves from the owner relation — this module never grows
 * identity plumbing (same stance as core/permissions.ts's ResourceRef).
 */
export interface ContributableRequest {
  ref: string;
  subject: string;
  urgency: string;
  category: string | null;
  slaDueAt: Date | null;
  isSafeguarding: boolean;
  ownerName: string | null;
}

/**
 * The one projection front-desk sends to a personal work surface. Returns null — no row at
 * all — for a safeguarding request.
 *
 * QM-D30: the safeguarding flag suppresses the row automatically and invisibly. NO row,
 * never a sanitised title — R3-19's never-hint rule. This is the deliberate OPPOSITE of
 * listProjection's keep-the-row queue masking, and the difference is the audience: a queue
 * is worked by the grant-holding desk, where hiding the row would let a safeguarding case
 * sit unworked precisely because nobody could see it; the contributed row goes to the
 * widest surface in the estate, where even a masked "named access only" line would announce
 * to everyone that a safeguarding case exists. On the widest surface the only projection
 * that carries nothing is no projection.
 */
export function contributedRow(req: ContributableRequest): ContributedRow | null {
  if (req.isSafeguarding) return null;

  return {
    module: 'front-desk',
    ref: req.ref,
    // QM-D30: the contributing module AUTHORS the title, under an explicit obligation — no
    // child's sensitive detail in a title. Here the title is the subject line; when this
    // graduates, subjects carrying a child's sensitive detail are THIS module's
    // responsibility to keep out of the titles it contributes — never the aggregator's to
    // filter, because the aggregator cannot know what it is looking at.
    title: req.subject,
    ownerName: req.ownerName,
    // QM-D31: claiming never restarts or replaces this — the queue target becomes the
    // personal target as-is, so a pool item cannot buy time by being claimed late.
    dueTarget: req.slaDueAt,
    priority: req.urgency,
    itemType: req.category,
  };
}

/** What pool selection needs to know about a row; a Prisma request satisfies it directly. */
export interface PoolCandidate {
  status: string;
  urgency: string;
  ownerId: string | null;
  aboutStaffIds: string[];
  slaDueAt: Date | null;
}

/** Same table as the queue page and core/my-work.ts — the three lists must order alike. */
const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const rank = (u: string) => URGENCY_RANK[u] ?? 4;

/**
 * The claimable pool. QM-D31: "an item with no personal owner is not a personal item at
 * all" — an unowned item is a QUEUE item by definition, so this selects the queue items the
 * actor could take: live (open | waiting), unowned, and not about the actor (QM-D33 — a
 * complaint about a person is closed to them, and a claim is the strongest possible way to
 * open it). Everything else is someone's personal item, a pre-queue capture, or closed.
 *
 * Generic like bucketMyWork: a richer row goes in and comes back out unchanged, ordered the
 * way the queue would work it — urgency, then how close the inherited target is — because
 * these ARE queue items and must not read in a different order than the queue they sit in.
 */
export function poolItems<T extends PoolCandidate>(rows: T[], actorId: string): T[] {
  return rows
    .filter(
      r =>
        (r.status === 'open' || r.status === 'waiting') &&
        r.ownerId === null &&
        !r.aboutStaffIds.includes(actorId),
    )
    .sort((x, y) => {
      const u = rank(x.urgency) - rank(y.urgency);
      if (u !== 0) return u;
      // No target sorts last — same 9e15 sentinel as app/(staff)/page.tsx.
      return (x.slaDueAt?.getTime() ?? 9e15) - (y.slaDueAt?.getTime() ?? 9e15);
    });
}

/**
 * The refusal a loser of a claim race sees. One string, exported, because the server action
 * needs it in TWO places: the pre-check below, and the atomic write whose WHERE clause is
 * the real lock — both losses must read identically to the person who was a moment late.
 */
export const CLAIM_RACE_REASON = 'Someone claimed this first — the pool moved under you.';

/**
 * Whether a claim can proceed, as a testable decision. This is the READABLE half of the
 * race protection: two actors can both pass it at the same instant, so the server action
 * additionally writes through `updateMany({ where: { ownerId: null } })` and treats a
 * zero-row result as this same refusal. Every deny carries a plain-language reason
 * (core/permissions.ts's discipline).
 */
export function claimDecision(req: { status: string; ownerId: string | null }): Decision {
  if (req.ownerId !== null) {
    return { allowed: false, reason: CLAIM_RACE_REASON };
  }
  if (req.status !== 'open' && req.status !== 'waiting') {
    return {
      allowed: false,
      reason:
        `Only live queue items can be claimed, and this one is '${req.status}' — ` +
        'it is not in the pool.',
    };
  }
  return {
    allowed: true,
    reason: 'Unowned and live — a queue item anyone in scope may take (QM-D31).',
  };
}
