// core/chase.ts — the chase ladder (QM-D14): which requests are OWED a "find the owner"
// nudge, derived at read time.
//
// PURE. No I/O, no Prisma, no Next imports, deterministic.
//
// The ruling: a breached item spawns an owned chase task, and the front desk owns the chase
// queue. Three constraints hold structurally, not by discipline:
//
//  1. Reference-only, never the narrative (HDT-9, R3-4): a chase says "FD-0142 is overdue —
//     find its owner". chaseTitle() takes ONLY the reference, so a subject, a family label or
//     a complaint story cannot even be passed in — the constraint lives in the signature. The
//     Chase model mirrors this: no narrative columns exist, so no chase step can ever widen
//     the audience of a restricted record.
//  2. Closing a chase never closes the item — two separate lifecycles. Nothing in this module
//     models a request status transition, and app/chase-actions.ts never touches
//     Request.status. Finding the person is not resolving the family's problem.
//  3. OWED is DERIVED here from the breached response clock against `now` (QM-D15's shape —
//     no stored flag anywhere); a Chase row exists only once the desk actually acts.
//
// The chase fires on the RESPONSE breach, never on a missed acknowledgement (QM-D14
// consequence 3): an unacknowledged item has its own badge and its own cheap remedy (look at
// it). The chase exists for the harder failure — a family still waiting for an ANSWER past
// target — which is why this module does not even take the ack fields as input.

import { addWorkingHours, slaState } from './sla';

/**
 * Working hours between chases on the same request. A chase that was just logged bought the
 * owner some time to act; nagging again inside the same half-day teaches the desk to ignore
 * the strip. Seed value; CONFIG in the real module, set with the desk like every target in
 * core/sla.ts.
 */
export const CHASE_COOLDOWN_WORKING_HOURS = 4;

/** The request fields the derivation needs — shaped so a Prisma row satisfies it directly. */
export interface ChaseableRow {
  id: string;
  ref: string;
  status: string;
  slaDueAt: Date | null;
  firstReplyAt: Date | null;
}

export interface OwedChase {
  id: string;
  ref: string;
  /** How far past the response target, in ms. Always positive — only breached rows are owed. */
  lateMs: number;
}

/**
 * Which of these requests are owed a chase right now. A request qualifies when:
 *
 *  - its RESPONSE clock is breached (core/sla.ts slaState — a first reply stops the clock,
 *    so a 'waiting' item that was answered is never chased);
 *  - its status is open or waiting. `unfiled` is deliberately excluded even though its
 *    response clock is already running: an unfiled breach has no owner to find because nobody
 *    has triaged it — its remedy is FILING, and it already sits at the top of the queue.
 *    Resolved and parked items have nothing left to chase;
 *  - no chase was logged inside the last CHASE_COOLDOWN_WORKING_HOURS.
 *
 * `lastChaseAt` maps requestId → the most recent chase's openedAt. A map rather than a set of
 * ids because a cooldown needs to know WHEN the desk last chased, not merely THAT it ever did —
 * and since logging a chase opens and closes it in the same act (app/chase-actions.ts), the
 * open/closed distinction carries no signal here; the timestamp does.
 *
 * Sorted most-overdue first: the family waiting longest is chased first.
 */
export function chasesOwed(
  rows: readonly ChaseableRow[],
  lastChaseAt: ReadonlyMap<string, Date>,
  now: Date,
): OwedChase[] {
  const owed: OwedChase[] = [];
  for (const r of rows) {
    if (r.status !== 'open' && r.status !== 'waiting') continue;
    if (slaState({ dueAt: r.slaDueAt, firstReplyAt: r.firstReplyAt, now }) !== 'breached') continue;
    const last = lastChaseAt.get(r.id);
    if (last && +addWorkingHours(last, CHASE_COOLDOWN_WORKING_HOURS) > +now) continue;
    // slaDueAt is non-null here: 'breached' is only reachable with a target set.
    owed.push({ id: r.id, ref: r.ref, lateMs: +now - +r.slaDueAt! });
  }
  return owed.sort((a, b) => b.lateMs - a.lateMs);
}

/**
 * The reference-only chase title. The signature takes ONLY the ref — not the request, not the
 * subject, not the family — so the narrative cannot reach a chase through this function even
 * by accident (HDT-9 constraint 1, enforced by the type). If a future caller "needs" more
 * than the ref here, that is the constraint being tested, not a gap to fill.
 */
export function chaseTitle(ref: string): string {
  return `${ref} is overdue — find its owner`;
}
