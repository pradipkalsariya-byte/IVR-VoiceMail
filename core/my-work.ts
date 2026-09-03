// core/my-work.ts — the staff "My work" stream: one person's owned requests, bucketed.
//
// PURE. No I/O, no Prisma, no Next imports, deterministic — same contract as the rest of
// core/. Clock states come from readClocks (QM-D15: derived at read time, never stored) and
// are never re-derived here with private arithmetic.
//
// QM-D32 (2026-08-07) is the shape of this file: a complaint ROUTED TO a staff member is
// ordinary work on their stream. There is deliberately no "complaints" bucket, no special
// section, no stigma — bucketing never looks at category, so a routed complaint lands in the
// same four buckets as a bus query. The one carve-out is QM-D33, inside the loop, and it is
// about complaints ABOUT the person, not complaints assigned to them.

import { readClocks, type ClockableRequest } from './clocks';

/**
 * What bucketing needs to know about a row. A superset row (a Prisma request with its
 * includes) satisfies this directly and comes back out unchanged — the generic keeps the
 * page's richer row type intact without this module knowing about it.
 */
export interface MyWorkRow extends ClockableRequest {
  id: string;
  ref: string;
  urgency: string;
  ownerId: string | null;
  /** QM-D33: the staff this complaint is ABOUT. Used here only to EXCLUDE, never to accrue. */
  aboutStaffIds: string[];
  /** A callback slip is still its owner's work — included, not a separate pile. */
  isSwitchboard: boolean;
}

export interface MyWorkBuckets<T extends MyWorkRow> {
  /** Owned, open, no human look recorded yet, ack clock running — most overdue first. */
  awaitingFirstLook: T[];
  /** Owned, open, acknowledged (or never given an ack target) — urgency, then target. */
  openWork: T[];
  /** Owned, the family owes the next move — urgency, then target. */
  waitingOnFamily: T[];
  /** Owned, resolved within the last RESOLVED_WINDOW_DAYS of `now` — newest first. */
  recentlyResolved: T[];
}

/**
 * How long a closed item stays on the stream before dropping off. Inclusive at the boundary:
 * resolved exactly seven days ago still shows. A seed value like core/sla.ts's targets —
 * CONFIG in the real module, never handed down.
 */
export const RESOLVED_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/** Same table as the queue page's working-queue sort — the two lists must order alike. */
const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const rank = (u: string) => URGENCY_RANK[u] ?? 4;

/**
 * Bucket one person's stream. EXCLUSIVE by construction: the status chain places every
 * surviving row in at most one bucket, so no row can appear twice. Rows that survive the two
 * exclusions but match no bucket (unfiled, not_a_request, long-resolved) simply do not appear
 * — they are not this person's live work.
 */
export function bucketMyWork<T extends MyWorkRow>(
  rows: T[],
  actorId: string,
  now: Date,
): MyWorkBuckets<T> {
  const b: MyWorkBuckets<T> = {
    awaitingFirstLook: [],
    openWork: [],
    waitingOnFamily: [],
    recentlyResolved: [],
  };

  for (const row of rows) {
    // QM-D33: a complaint ABOUT this person never reaches their stream — suppress the ROW,
    // deliberately unlike safeguarding's keep-the-row masking (listProjection). A masked row
    // sitting in "my work" would itself leak that a complaint about this person exists; and
    // unlike a desk that must still work a safeguarding case it cannot read, the about-person
    // has no work claim on the record at all. Nothing to work means nothing to show. The
    // substance reaches them through a named-person conversation recorded on the complaint.
    if (row.aboutStaffIds.includes(actorId)) continue;

    // Ownership is the sole admission ticket. An unowned row belongs to the queue's
    // "no owner" count, not to anyone's stream.
    if (row.ownerId !== actorId) continue;

    // From here bucketing sees only status and the clocks — never category, never a
    // complaint flag. That absence is QM-D32 enforced structurally.
    if (row.status === 'open') {
      // readClocks, never re-derived (QM-D15): due/overdue = the ack clock is running and no
      // human look is recorded; met = acknowledged; na = no ack target was ever set (a row
      // filed before the ack clock existed, or a channel that stamps none).
      const ack = readClocks(row, now).ackState;
      if (ack === 'due' || ack === 'overdue') b.awaitingFirstLook.push(row);
      else b.openWork.push(row);
    } else if (row.status === 'waiting') {
      b.waitingOnFamily.push(row);
    } else if (
      row.status === 'resolved' &&
      row.resolvedAt !== null &&
      +now - +row.resolvedAt <= RESOLVED_WINDOW_DAYS * DAY_MS
    ) {
      // Older than the window drops off entirely — closure means the list gets shorter. A
      // resolved row with no recorded instant cannot be placed in the window, so it stays
      // off rather than pinned forever.
      b.recentlyResolved.push(row);
    }
  }

  // Most-overdue first: ackRemainingMs is signed (negative = late), so ascending puts the
  // longest-unseen filing on top. Non-null for every row here by construction (due/overdue
  // both mean a target exists); the ?? 0 is for the type, not a case.
  const ackRemaining = new Map<string, number>();
  for (const r of b.awaitingFirstLook) {
    ackRemaining.set(r.id, readClocks(r, now).ackRemainingMs ?? 0);
  }
  b.awaitingFirstLook.sort((x, y) => ackRemaining.get(x.id)! - ackRemaining.get(y.id)!);

  // The queue page's working-queue order: urgency, then how close the target is; no target
  // sorts last (9e15 sentinel, same as app/page.tsx).
  const byUrgencyThenTarget = (x: T, y: T) => {
    const u = rank(x.urgency) - rank(y.urgency);
    if (u !== 0) return u;
    return (x.slaDueAt?.getTime() ?? 9e15) - (y.slaDueAt?.getTime() ?? 9e15);
  };
  b.openWork.sort(byUrgencyThenTarget);
  b.waitingOnFamily.sort(byUrgencyThenTarget);

  b.recentlyResolved.sort(
    (x, y) => (y.resolvedAt?.getTime() ?? 0) - (x.resolvedAt?.getTime() ?? 0),
  );

  return b;
}
