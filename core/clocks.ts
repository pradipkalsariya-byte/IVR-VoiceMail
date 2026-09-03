// core/clocks.ts — where the two clocks stand, derived at READ time.
//
// PURE. This file is the enforcement of QM-D15 (2026-08-07): there is deliberately NO stored
// overdue flag anywhere in the schema. "Overdue" is a relationship between a stored target and
// the present moment, so it is computed here on every read. A stored flag needs a scheduler to
// flip it, and a scheduler outage would then read as "nothing is overdue" — the exact silent
// failure the ruling exists to prevent. Every list that shows lateness calls this with `now`.
//
// The two clocks (QM-D12 / QM-D34):
//   - the ACK clock: filing -> a human looked (acknowledgedAt).
//   - the RESPONSE clock: arrival -> first reply (firstReplyAt), per SD-COM-11's target.
// They are independent — acknowledging does not touch the response clock and vice versa.

/**
 * met     — the clock stopped (its event happened), on time or not. Mirrors slaState's ruling:
 *           a reply that went out late is still a reply; lateness lives in the negative
 *           remainingMs, not in a permanent scarlet letter on the state.
 * due     — the clock is running and the target is still ahead of `now`.
 * overdue — the clock is running and the target has passed. Derived, never stored (QM-D15).
 * na      — no clock: the target was never set, or the item is parked out of the queue.
 */
export type ClockState = 'met' | 'due' | 'overdue' | 'na';

/** The request fields the derivation needs — shaped so a Prisma row satisfies it directly. */
export interface ClockableRequest {
  status: string;
  slaDueAt: Date | null;
  ackDueAt: Date | null;
  acknowledgedAt: Date | null;
  firstReplyAt: Date | null;
  resolvedAt: Date | null;
}

export interface ClockReading {
  ackState: ClockState;
  responseState: ClockState;
  /**
   * Signed distance to the target in ms, `null` when the state is `na`. Positive = margin,
   * negative = lateness. For a STOPPED clock this is frozen at the stopping moment
   * (target − stoppedAt), so "acknowledged 40 minutes late" stays readable forever; for a
   * RUNNING clock it is target − now.
   */
  ackRemainingMs: number | null;
  responseRemainingMs: number | null;
}

/**
 * Statuses whose clocks read `na` outright. `not_a_request` is vendor noise / machine mail
 * kept on record but out of the working queue — nobody owes a robot an acknowledgement any
 * more than a reply (the ~50%-solicitation finding). `unfiled` is deliberately NOT here: its
 * ack clock is `na` anyway (no ackDueAt until filing, QM-D12), but its RESPONSE clock is
 * already running — the target anchors on arrival, and slow triage must not hide lateness.
 */
const PARKED_STATUSES: ReadonlySet<string> = new Set(['not_a_request']);

/** One clock: a target, an optional stopping event, and the present moment. */
function readOne(dueAt: Date | null, stoppedAt: Date | null, now: Date): {
  state: ClockState;
  remainingMs: number | null;
} {
  if (!dueAt) return { state: 'na', remainingMs: null };
  // Stopped: compare against the moment it HAPPENED, never against `now` — otherwise an
  // on-time acknowledgement would drift into "overdue" as the page is re-read later.
  if (stoppedAt) return { state: 'met', remainingMs: +dueAt - +stoppedAt };
  const remainingMs = +dueAt - +now;
  // The boundary instant itself is still `due` (remainingMs 0), matching slaState's `< 0`.
  return { state: remainingMs < 0 ? 'overdue' : 'due', remainingMs };
}

/** The read-time derivation. Call with the row and `now`; store nothing (QM-D15). */
export function readClocks(req: ClockableRequest, now: Date): ClockReading {
  if (PARKED_STATUSES.has(req.status)) {
    return { ackState: 'na', responseState: 'na', ackRemainingMs: null, responseRemainingMs: null };
  }

  const ack = readOne(req.ackDueAt, req.acknowledgedAt, now);
  // The response clock stops at the first reply; a request resolved WITHOUT an outbound
  // message (answered on the phone, walk-in handled on the spot) stops at resolution instead —
  // the family got their answer, just not in writing. firstReplyAt wins when both exist
  // because it is the earlier event and the one SD-COM-11 measures.
  const response = readOne(req.slaDueAt, req.firstReplyAt ?? req.resolvedAt, now);

  return {
    ackState: ack.state,
    responseState: response.state,
    ackRemainingMs: ack.remainingMs,
    responseRemainingMs: response.remainingMs,
  };
}
