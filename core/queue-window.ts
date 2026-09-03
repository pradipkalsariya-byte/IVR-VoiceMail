// core/queue-window.ts — what belongs in the working queue, and what does not.
//
// Two rulings from the 26-Aug-2026 team review, kept together because they are both answers to
// the same complaint (the queue is full of things nobody needs to look at) and because the page
// has to apply them in one pass:
//
//   feedback #6  — "Six years of old email, we ignore it. I will ignore anything before one
//                   month, only for learning I will use." (transcript 00:49:06)
//   feedback #8  — "The call log needs to be removed, and what to do with the call log will be
//                   addressed separately." (transcript 00:49:49)
//
// Pure and side-effect free so both can be tested without a database, and so the queue page and
// the switchboard page cannot drift apart about which items each of them owns.

/**
 * The date the desk's records begin.
 *
 * VK, 26-Aug-2026: *"all emails before Aug 1 2026 can be ignored in the app itself. Old emails
 * are to be used for the learning and then removed from the app. We will focus only on the
 * emails from August 1."*
 *
 * A FIXED date, not a rolling window — deliberately. A rolling "last 31 days" would keep
 * quietly dropping August as September arrives, so the desk would lose the very period it is
 * meant to be working. This line moves only when someone decides to move it.
 *
 * Stored as a UTC instant because arrivedAt is; 2026-08-01 IST begins at 18:30 UTC on 31 July,
 * and starting the day in the wrong timezone would strand a few hours of real mail either side.
 */
export const RECORDS_BEGIN_AT = new Date('2026-07-31T18:30:00.000Z');

export interface QueueCandidate {
  arrivedAt: Date;
  /** unfiled | open | waiting | resolved | not_a_request */
  status: string;
  ownerId?: string | null;
  isSwitchboard: boolean;
}

/** The cutoff itself. Takes `now` only so callers read naturally and tests can be explicit. */
export function queueWindowStart(_now?: Date, from: Date = RECORDS_BEGIN_AT): Date {
  return from;
}

/**
 * Is this item recent enough for the working queue?
 *
 * The age limit deliberately applies ONLY to items nobody has picked up. A request that has
 * been filed, or that has an owner, stays visible however old it is — ageing it out would hide
 * live work, which is the opposite of what was asked for. What VK wanted gone was the
 * six-year backfill of untouched mail, not somebody's open case.
 *
 * The consequence is worth stating plainly: an old item that someone is actually working
 * cannot silently vanish, and an old item that nobody ever filed cannot silently accumulate.
 */
export function withinQueueWindow(
  r: QueueCandidate,
  now?: Date,
  from: Date = RECORDS_BEGIN_AT,
): boolean {
  if (r.status !== 'unfiled') return true;
  if (r.ownerId) return true;
  return r.arrivedAt.getTime() >= from.getTime();
}

/**
 * Does this item belong in the working queue at all?
 *
 * Switchboard slips do not, ever. A missed-call slip records that a line rang unanswered — it
 * has no subject-matter yet ("call back, then file what it was actually about"), so it cannot
 * be triaged, only chased. On 26-Aug they were 395 of the 440 items waiting for a person, which
 * is the whole reason this rule exists. They are NOT discarded: they move to their own stream,
 * where a person doing callbacks can work them as a batch.
 */
export function belongsInQueue(
  r: QueueCandidate,
  now?: Date,
  from: Date = RECORDS_BEGIN_AT,
): boolean {
  if (r.isSwitchboard) return false;
  return withinQueueWindow(r, now, from);
}

/** The mirror of belongsInQueue: what the switchboard stream owns. */
export function belongsInSwitchboard(r: QueueCandidate): boolean {
  return r.isSwitchboard;
}

/**
 * How many items the age limit is holding back, so the queue can say so out loud.
 *
 * "Nothing is lost" is the promise this whole app makes, and a silent date filter would break
 * it — the older items would simply stop existing as far as anyone could tell. The queue shows
 * this count with a way to see them.
 */
export function agedOutCount(
  rows: readonly QueueCandidate[],
  now?: Date,
  from: Date = RECORDS_BEGIN_AT,
): number {
  return rows.filter(r => !r.isSwitchboard && !withinQueueWindow(r, now, from)).length;
}
