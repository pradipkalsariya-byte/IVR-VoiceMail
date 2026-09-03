// core/assignment.ts — who should own this, and what happens when they do not act.
//
// Three feedback items that only make sense together, from the 26-Aug-2026 review:
//
//   #21 roster      — "मैंने रोस्टर बनाया… दिवाली तक का" (transcript 00:53:10). The desk already
//                     keeps one by hand. Automate the rotation, keep every cell editable.
//   #18 routing     — "give the logic… mostly handle this type of queries — कि ये उसके पास भेजो",
//                     "with the option of changing it" (00:25:14).
//   #20 escalation  — "if Ayushi started the queue, she claimed it, and if she is missing on
//                     that day" (00:44:34) and "either it gets automatically escalated" (00:45:31).
//
// VK's triage settled how they combine: THE ROSTER SETS WHO IS ON DUTY; CATEGORY ROUTING PICKS
// WITHIN THAT SET. And for absence: an explicit away flag reassigns immediately, with an
// untouched-for-N-hours timer as the backstop, because the flag will not be set on the day
// somebody is unexpectedly out — which is the day it matters.
//
// PURE. No database, no clock of its own. Every decision returns a REASON, because an
// assignment nobody can explain is one the desk will not trust and will quietly work around.

import { GROUP_ROOT_ID } from './permissions';

export interface Candidate {
  id: string;
  name: string;
  scopeOrgUnitId: string;
  permissions: string[];
  /** Set while someone has marked themselves away. Null when they are available. */
  awayUntil?: Date | null;
}

export interface AssignmentInput {
  campusOrgUnitId: string;
  /** The filed category, or the suggestion when nothing is filed yet. Null is allowed. */
  category: string | null;
  /** Staff ids rostered on for this campus today. Empty means no roster exists for today. */
  onDutyIds: readonly string[];
  /** category → staff id, for this campus. */
  routes: ReadonlyMap<string, string>;
  candidates: readonly Candidate[];
  /** Staff this request is ABOUT — never assignable to it (QM-D32). */
  aboutStaffIds: readonly string[];
  now: Date;
}

export interface AssignmentDecision {
  ownerId: string | null;
  /** Always set, whether or not an owner was found. Shown to a person, so plain language. */
  reason: string;
}

const isAvailable = (c: Candidate, now: Date) =>
  !c.awayUntil || c.awayUntil.getTime() <= now.getTime();

const canWorkHere = (c: Candidate, campusOrgUnitId: string) =>
  c.scopeOrgUnitId === GROUP_ROOT_ID || c.scopeOrgUnitId === campusOrgUnitId;

/** Someone who can actually be given a request: right campus, holds the grant, not away. */
function eligible(input: AssignmentInput): Candidate[] {
  return input.candidates.filter(
    c =>
      canWorkHere(c, input.campusOrgUnitId) &&
      c.permissions.includes('resolve') &&
      !input.aboutStaffIds.includes(c.id) &&
      isAvailable(c, input.now),
  );
}

/**
 * Choose an owner.
 *
 * The order is deliberate and each fallback is narrower than the last:
 *
 *   1. The category's routed person, IF they are on duty today. The specialist, when available.
 *   2. Anyone else on duty today. Cover beats expertise — a request with an owner who is
 *      present beats one with the right owner who is not.
 *   3. Nobody. Explicitly, with a reason. Returning a plausible-looking owner who cannot act
 *      is worse than leaving it unowned: the queue stops flagging it as needing one.
 *
 * Never picks someone the request is ABOUT, and never someone outside the campus — the same
 * two rules assignableOwner enforces on a manual assignment, applied here so the automatic
 * path cannot do what a person is forbidden to do by hand.
 */
export function chooseOwner(input: AssignmentInput): AssignmentDecision {
  const pool = eligible(input);
  const onDuty = pool.filter(c => input.onDutyIds.includes(c.id));

  if (input.onDutyIds.length === 0) {
    // No roster for today is a real state, not an error — the desk may not have filled it in.
    // Fall back to anyone eligible rather than refusing to assign at all.
    const anyone = pool[0];
    return anyone
      ? {
          ownerId: anyone.id,
          reason: `Nobody is rostered for today, so this went to ${anyone.name}, who is available and works this campus.`,
        }
      : { ownerId: null, reason: 'Nobody is rostered for today and nobody else is available to take it.' };
  }

  const routedId = input.category ? input.routes.get(input.category) : undefined;
  const routed = onDuty.find(c => c.id === routedId);
  if (routed) {
    return {
      ownerId: routed.id,
      reason: `${routed.name} handles ${input.category} at this campus and is on duty today.`,
    };
  }

  if (routedId) {
    const named = input.candidates.find(c => c.id === routedId);
    const why = named && !isAvailable(named, input.now) ? 'is away' : 'is not on duty today';
    const cover = onDuty[0];
    return cover
      ? {
          ownerId: cover.id,
          reason: `${named?.name ?? 'The usual owner'} handles ${input.category} but ${why}, so this went to ${cover.name}, who is on duty.`,
        }
      : {
          ownerId: null,
          reason: `${named?.name ?? 'The usual owner'} handles ${input.category} but ${why}, and nobody else is on duty to cover.`,
        };
  }

  const cover = onDuty[0];
  return cover
    ? {
        ownerId: cover.id,
        reason: input.category
          ? `No one is set to handle ${input.category} at this campus, so this went to ${cover.name}, who is on duty today.`
          : `This has no category yet, so it went to ${cover.name}, who is on duty today.`,
      }
    : { ownerId: null, reason: 'Nobody on duty today can take this one.' };
}

// ─────────────────────────────────────────────────────────────── escalation

export interface EscalationInput {
  ownerId: string | null;
  /** When the current owner took it on. Null when it has never been owned. */
  ownerSetAt: Date | null;
  /** Has the family had a reply yet? */
  firstReplyAt: Date | null;
  urgency: string;
  owner?: Candidate | null;
  now: Date;
}

export interface EscalationDecision {
  escalate: boolean;
  reason: string;
}

/**
 * How long an owner has before an untouched request goes back to the pool, by urgency.
 *
 * Hours rather than days: a critical item sitting overnight is the failure this exists to
 * catch, and a day-scale timer would sleep through it.
 */
export const ESCALATE_AFTER_HOURS: Record<string, number> = {
  critical: 2,
  high: 4,
  normal: 24,
  low: 48,
};

/**
 * Should this go back to the pool?
 *
 * Two triggers, per VK's triage — "both: flag if set, timer as the backstop":
 *
 *   THE FLAG is immediate and explicit. Somebody marked themselves away; their live work
 *   should not wait for a timer to notice.
 *   THE TIMER catches everything else, and is the one that will actually fire most often —
 *   nobody sets an away flag on the morning they wake up ill, which is precisely the morning
 *   their queue needs covering.
 *
 * Escalation means the owner is CLEARED and the item returns to the claimable pool. It is not
 * a reassignment to a named person: handing it to a specific someone who may also be away just
 * moves the problem, and the pool is visible to everyone who could pick it up.
 */
export function shouldEscalate(input: EscalationInput): EscalationDecision {
  if (!input.ownerId) {
    return { escalate: false, reason: 'Nobody owns it, so there is nothing to escalate from.' };
  }
  if (input.firstReplyAt) {
    return { escalate: false, reason: 'The family has already had a reply.' };
  }

  if (input.owner?.awayUntil && input.owner.awayUntil.getTime() > input.now.getTime()) {
    return {
      escalate: true,
      reason: `${input.owner.name} is marked away until ${input.owner.awayUntil.toISOString().slice(0, 10)}, and the family has not been replied to. Returned to the pool.`,
    };
  }

  if (!input.ownerSetAt) {
    // Owned, but we do not know since when — an older record from before this was tracked.
    // Not a reason to escalate: acting on an unknown would churn historical work.
    return { escalate: false, reason: 'No record of when this was taken on, so the timer cannot judge it.' };
  }

  const hours = (input.now.getTime() - input.ownerSetAt.getTime()) / 3_600_000;
  const limit = ESCALATE_AFTER_HOURS[input.urgency] ?? ESCALATE_AFTER_HOURS.normal;
  if (hours >= limit) {
    return {
      escalate: true,
      reason: `Taken on ${Math.floor(hours)} hours ago and the family still has no reply — past the ${limit}-hour mark for ${input.urgency} items. Returned to the pool.`,
    };
  }

  return {
    escalate: false,
    reason: `Owned for ${Math.floor(hours)} of the ${limit} hours allowed for ${input.urgency} items.`,
  };
}

// ─────────────────────────────────────────────────────────────── roster

/**
 * Rotate a list of people across a run of days.
 *
 * The desk keeps a roster by hand today ("Monday to Saturday, paired with the driver"), and VK
 * asked for it to be automated "हर पंद्रह दिन में… ऑटोमेट हो जाएगा… always editable". This
 * generates the default pattern; the stored roster is what actually governs, so any cell a
 * person edits stays edited.
 *
 * Deterministic from the start date, so regenerating the same fortnight twice produces the same
 * roster — a generator that shuffled would silently rewrite a roster someone had already
 * arranged their week around.
 */
export function rotate(
  staffIds: readonly string[],
  days: number,
  perDay = 1,
): string[][] {
  if (staffIds.length === 0 || days <= 0) return [];
  const out: string[][] = [];
  let cursor = 0;
  for (let d = 0; d < days; d++) {
    const day: string[] = [];
    for (let i = 0; i < Math.min(perDay, staffIds.length); i++) {
      day.push(staffIds[cursor % staffIds.length]);
      cursor++;
    }
    out.push(day);
  }
  return out;
}
