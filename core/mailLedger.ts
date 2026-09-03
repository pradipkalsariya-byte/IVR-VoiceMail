// core/mailLedger.ts — the mail ledger's closed outcome vocabulary (2026-08-24, step 3 of
// the email-visibility round). PURE. One word per terminal branch of lib/ingest/run.ts, in
// desk English — the branch map recruitment's core/careersMail.ts established as the estate
// shape: the pipeline decides, this file only names.
//
// Branch map (lib/ingest/run.ts):
//   new_request      — became a fresh request (Needs filing; the app rail lands pre-filed).
//   joined_thread    — a reply, appended to the request its thread already has.
//   parked_vendor    — kept on record, out of the working queue: reads as vendor outreach.
//   parked_automated — machine traffic from the school's own systems, parked on arrival.
//   already_had      — pulled again and recognised by Message-ID; nothing was created.
//   error            — processing threw; the detail carries the error text.
//
// A missed-call REPORT mail takes its own outcome above (usually parked_automated) and a
// detail sentence naming how many call captures it exploded into — the captures are
// requests, not mailbox messages, so they never get ledger rows of their own.

export const MAIL_LEDGER_OUTCOMES = [
  'new_request',
  'joined_thread',
  'parked_vendor',
  'parked_automated',
  'already_had',
  'error',
] as const;

export type MailLedgerOutcome = (typeof MAIL_LEDGER_OUTCOMES)[number];

export function isMailLedgerOutcome(value: string): value is MailLedgerOutcome {
  return (MAIL_LEDGER_OUTCOMES as readonly string[]).includes(value);
}

/** Chip text — desk English, no schema words. */
export const LEDGER_OUTCOME_LABEL: Readonly<Record<MailLedgerOutcome, string>> = {
  new_request: 'Became a request',
  joined_thread: 'Joined its thread',
  parked_vendor: 'Parked — vendor',
  parked_automated: 'Parked — automated',
  already_had: 'Already had it',
  error: 'Failed to process',
};

/** DS semantic tones. Success = it landed as work; outline = nothing new was created (which
 *  is the dedupe or the noise filter doing its job); danger = a human should look. */
export type LedgerTone = 'success' | 'warning' | 'danger' | 'outline';

export const LEDGER_OUTCOME_TONE: Readonly<Record<MailLedgerOutcome, LedgerTone>> = {
  new_request: 'success',
  joined_thread: 'success',
  parked_vendor: 'outline',
  parked_automated: 'outline',
  already_had: 'outline',
  error: 'danger',
};

/** Total render fallbacks — a stored outcome this build has not learned shows itself as-is in
 *  a neutral chip rather than crashing the page (the same posture as core/labels.ts). */
export function ledgerOutcomeLabel(outcome: string): string {
  return isMailLedgerOutcome(outcome) ? LEDGER_OUTCOME_LABEL[outcome] : outcome;
}

export function ledgerOutcomeTone(outcome: string): LedgerTone {
  return isMailLedgerOutcome(outcome) ? LEDGER_OUTCOME_TONE[outcome] : 'outline';
}

/**
 * The row's way back to the actual mail — only for the real source. Gmail's UI addresses a
 * thread directly via the #all/<threadId> fragment; a demo thread id would produce a link
 * that opens somebody's own inbox at a nonsense anchor, so demo rows get no link at all.
 */
export function gmailThreadUrl(source: string, threadId: string | null): string | null {
  if (source !== 'gmail' || !threadId) return null;
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

/**
 * Whether a stored thread id is Gmail's own — real Gmail thread ids are long hex; every
 * fixture's is a readable slug ('demo-thr-…', 'app-thr-…', 't-…'). Requests don't store a
 * source name, so surfaces that link from a REQUEST (the record page) decide by this shape —
 * the same rule the ledger backfill uses. A fabricated row must never grow a Gmail link.
 */
export function looksLikeGmailThreadId(threadId: string | null): boolean {
  return Boolean(threadId && /^[0-9a-f]{10,}$/.test(threadId));
}

export function gmailThreadUrlFromRequest(sourceThreadId: string | null): string | null {
  return looksLikeGmailThreadId(sourceThreadId)
    ? gmailThreadUrl('gmail', sourceThreadId)
    : null;
}
