// core/app-rail.ts — the parent app rail: what a submission files as, and which rails carry
// a reply back (QM-D34 / QM-D35).
//
// PURE. No I/O, no Prisma, no Next imports, deterministic.
//
// QM-D34: "A parent-raised conversation and its complaints-spine record are ONE item. The
// thread is the parent's face; the queue item is the staff face. Not two records kept in
// step." This module shapes the one record at the moment the parent acts — the two faces
// cannot drift because there is nothing to keep in step.

import { getClassifier } from './classify';
import { derivedSeriousness, type Seriousness } from './permissions';
import { APP_ACK_TARGET_WORKING_HOURS } from './ingest';
import { addWorkingHours, clockStart, slaDue, DEFAULT_DESK, type DeskHours } from './sla';
import { isParentCategory, isSafeguardingCategory, type Urgency } from './taxonomy';

export interface AppSubmissionFields {
  channel: 'app';
  status: 'open';
  /** The parent's own menu pick — the routing that filing exists to do (QM-D34(5)). */
  category: string;
  urgency: Urgency;
  subject: string;
  body: string;
  arrivedAt: Date;
  clockStartsAt: Date;
  slaDueAt: Date;
  ackDueAt: Date;
  acknowledgedAt: null;
  seriousness: Seriousness;
  isSafeguarding: boolean;
  suggestedCategory: string;
  suggestedUrgency: Urgency;
  suggestionReason: string;
  /** Not a column — callers word the 'classified' trail leg with it, as every channel does. */
  suggestionConfidence: 'high' | 'low';
}

/**
 * QM-D34(5): "On this rail, submission IS filing — the parent performed the routing that
 * filing exists to do. QM-D12's clock-starts-on-filing is satisfied at submission here, and
 * the app's 'request received' acknowledgement is correct rather than premature."
 *
 * In one shape, that means: status 'open' with no unfiled stop and no triage step (the menu
 * is deterministic, SD-COM-3); BOTH clocks anchor on `now` — the response clock because
 * arrival and filing are the same instant on this rail, the acknowledgement clock because
 * filing just happened; and acknowledgedAt stays null, because filed is not LOOKED AT — the
 * family's wait for a first human look starts now, it does not end now.
 */
export function appSubmission(
  now: Date,
  category: string,
  content: { subject: string; body: string },
  desk: DeskHours = DEFAULT_DESK,
): AppSubmissionFields {
  // The classifier runs as a SUGGESTION beside the parent's pick, never over it (SD-COM-3
  // concierge suggest-only; AI-13: the assistant never acts). It has two jobs here:
  // safeguarding is content-based, never flag-based (R3-18) — a safety case the parent filed
  // under "transport" must still surface — and the parent face has no urgency field (a parent
  // doesn't triage), so the suggested urgency is adopted as the working value exactly as the
  // email rail adopts it at ingest. Staff can re-file either; the parent's routing stands.
  const sug = getClassifier('rules').classify({
    subject: content.subject,
    body: content.body,
    // The rail exists only behind a signed-in family account (QM-D38) — always a known sender,
    // so the vendor-noise heuristics have no business here.
    senderIsKnownFamily: true,
  });

  // A pick outside the parent menu (a stale client, menu drift) falls to 'unclassified' so it
  // LOOKS untriaged and a person reads it — never silently adopted, never guessed. Same rule
  // as planIngest's app path and the classifier's own honest default.
  const chosen = isParentCategory(category) ? category : 'unclassified';

  // Safeguarding by content OR by door: choosing "My child's safety" from the menu is itself
  // the parent naming the situation, so Tier-2 handling attaches even when the words are mild
  // — a quiet "I'd rather explain in person" through the safety door is still a safety case.
  const isSafeguarding = sug.isSafeguarding || isSafeguardingCategory(chosen);

  return {
    channel: 'app',
    status: 'open',
    category: chosen,
    urgency: sug.urgency,
    subject: content.subject,
    body: content.body,
    arrivedAt: now,
    clockStartsAt: clockStart(now, desk),
    slaDueAt: slaDue(now, sug.urgency, desk),
    ackDueAt: addWorkingHours(now, APP_ACK_TARGET_WORKING_HOURS, desk),
    acknowledgedAt: null,
    seriousness: derivedSeriousness({ urgency: sug.urgency, isSafeguarding }),
    isSafeguarding,
    suggestedCategory: sug.category,
    suggestedUrgency: sug.urgency,
    suggestionReason: sug.reason,
    suggestionConfidence: sug.confidence,
  };
}

// ---------------------------------------------------------------------------------------
// The engine's rail choice (QM-D35).
// ---------------------------------------------------------------------------------------

export type Rail = 'app' | 'email';

/**
 * QM-D35: "A reply is authored once, as content plus a delivery intent, and handed to the
 * communications engine. The engine chooses the rail per recipient — in-app where a login
 * exists, falling back to email where it does not." The AUTHOR never picks rails — which is
 * how QM-D8's one-outbound-voice holds by construction: one authored message, one history,
 * whichever rail carried it.
 *
 * Both-when-both is the phasing reality, not a luxury: for the next ten months every in-app
 * reply also leaves by email, because the app cannot be assumed read until families live in
 * it. The thread stays the record either way.
 *
 * Neither yields an empty set the CALLER must surface — an unreachable recipient is a fact
 * to show a human, never to swallow.
 */
export function chooseRails(recipient: { hasAppLogin: boolean; hasEmail: boolean }): Rail[] {
  const rails: Rail[] = [];
  if (recipient.hasAppLogin) rails.push('app');
  if (recipient.hasEmail) rails.push('email');
  return rails;
}

/**
 * Whether an email reply can actually be SENT for this specific request — not just whether the
 * 'email' rail is theoretically available. `chooseRails`'s hasEmail is a FAMILY fact (does this
 * family have an address on file); this is a REQUEST fact (does this particular request have a
 * real Gmail thread to reply into). The two diverge on purpose: an app/call/walkin request whose
 * linked family also happens to carry an email (every seed fixture does) reports 'email' as an
 * available rail but has no thread — attempting to send would either crash or send an
 * unthreaded message under a Message-ID that was never real. Added 2026-08-12 alongside real
 * sending going live, specifically so that gate could be tested without a database.
 */
export function canSendEmailReply(
  req: { channel: string; sourceMessageId: string | null; sourceThreadId: string | null },
  familyEmailKey: string | null | undefined,
): boolean {
  return Boolean(
    req.channel === 'email' && req.sourceMessageId && req.sourceThreadId && familyEmailKey,
  );
}

/**
 * The honest promise shown above the reply box — must never claim more than reply() will
 * actually do. `rails` alone over-promises in two ways this closes: `chooseRails`'s 'email'
 * entry is a FAMILY fact that `canSendEmailReply` may refuse per-request (see its own comment),
 * and pilot mode means a real send still leaves, just not to the family. In-app is unaffected
 * by either — it never left the system to begin with (VK, 2026-08-12: keep it normal).
 */
export function replyPromiseNote(args: {
  rails: Rail[];
  canSendEmail: boolean;
  /** Non-null only when pilot mode is genuinely active AND a reviewer address is configured. */
  pilotReviewerEmail: string | null;
}): string {
  const app = args.rails.includes('app');
  const emailClaimed = args.rails.includes('email') && args.canSendEmail;

  if (!app && !emailClaimed) {
    return 'No rail is available for this sender — no app login, no email on record. The trail will say so honestly.';
  }
  if (emailClaimed && args.pilotReviewerEmail) {
    const appNote = app ? ' In-app still reaches the family directly — this only redirects email.' : '';
    return `PILOT MODE: the email half goes to ${args.pilotReviewerEmail} for review, not the family.${appNote}`;
  }
  if (app && emailClaimed) return 'Reaches the family in-app + email, from the school’s address.';
  if (app) return 'Reaches the family in-app.';
  return 'Reaches the family by email, from the school’s address.';
}

/** How a trail leg names the rails — "Replied to the family (N characters) — in-app + email." */
export function railsLabel(rails: Rail[]): string {
  const app = rails.includes('app');
  const email = rails.includes('email');
  if (app && email) return 'in-app + email';
  if (app) return 'in-app';
  if (email) return 'by email';
  return 'no rail available (no app login, no email on record)';
}

/**
 * The parent face's whole vocabulary of state — three phrases and a closing one, on purpose.
 * 'unfiled', 'open' and every internal distinction collapse to "With the school": queue
 * mechanics are the staff face (QM-D34(1)), and a parent needs to know whose move it is,
 * nothing else. 'waiting' is the desk's word for "we replied"; on this face that reads as
 * the ball being with the family.
 */
export function parentStatusLabel(status: string): string {
  if (status === 'resolved') return 'Resolved';
  if (status === 'waiting') return 'We’ve replied — over to you';
  // A parked non-request still reads honestly rather than pretending motion.
  if (status === 'not_a_request') return 'Closed — no action was needed';
  return 'With the school';
}
