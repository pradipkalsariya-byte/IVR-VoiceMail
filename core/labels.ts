// core/labels.ts — the staff face's human vocabulary. PURE.
//
// Every enum the schema stores (status, activity kind, urgency) has exactly one staff-facing
// label here, and the UI renders NOTHING it cannot label — the fallback humanises rather than
// leaking snake_case. This file exists because the 2026-08-09 UX review found three leaks in
// shipped screens: `not_a_request` printed verbatim on /patterns, `triage_approved` as a chip
// on the record trail, and the record page presenting the assistant's suggestion as a taxonomy
// slug (`child-safety`) inside what its own copy calls a plain-language explanation.
//
// The parent face has its OWN, smaller vocabulary (core/app-rail.ts parentStatusLabel) and
// must not import this one: "Needs filing" is desk language a parent should never see.

import type { Status } from './taxonomy';
import { guessNameFromAddress, isParentAddress, isStudentAddress, isAlumnusAddress } from './senders';

export const STATUS_LABEL: Record<Status, string> = {
  unfiled: 'Needs filing',
  open: 'Open',
  waiting: 'Waiting on the family',
  resolved: 'Resolved',
  not_a_request: 'Not a request',
};

export const statusLabel = (status: string): string =>
  STATUS_LABEL[status as Status] ?? humanise(status);

/** Trail entries. Keyed by Activity.kind as written in app/actions + ingestion. */
const ACTIVITY_LABEL: Record<string, string> = {
  filed: 'Filed',
  classified: 'Suggestion recorded',
  assigned: 'Owner set',
  acknowledged: 'First look',
  replied: 'Replied',
  resolved: 'Resolved',
  reopened: 'Reopened',
  note: 'Note',
  chased: 'Chase logged',
  conveyed: 'Conversation held',
  triage_approved: 'Second look approved',
};

export const activityKindLabel = (kind: string): string =>
  ACTIVITY_LABEL[kind] ?? humanise(kind);

export const URGENCY_LABEL: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

export const urgencyLabel = (urgency: string): string =>
  URGENCY_LABEL[urgency] ?? humanise(urgency);

/** Last-resort formatter: an unlabelled value still never renders as snake_case. */
export function humanise(value: string): string {
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Who to show for a request with no linked Family — added 2026-08-12 so "unknown sender" isn't
 * the default for every real parent until a roster import or a phone match links one. A GUESS
 * from the address pattern only (never a verified identity — that's what a linked Family is
 * for), so it returns null rather than a label whenever the address doesn't fit the pattern; the
 * call site's own generic fallback ("Sender not identified" / "unknown sender") still applies.
 */
export function guessedSenderLabel(senderEmail: string | null): string | null {
  if (!senderEmail) return null;
  const name = guessNameFromAddress(senderEmail);
  if (!name) return null;
  if (isParentAddress(senderEmail)) return `Parent of ${name}`;
  if (isStudentAddress(senderEmail) || isAlumnusAddress(senderEmail)) return name;
  return null;
}

/**
 * The sender-identity slot for a list row — masked in perfect lockstep with
 * core/permissions.ts:listProjection's subject/body masking. A safeguarding case masks WHO, not
 * just WHAT: a family's real, roster-sourced name (or an address-pattern guess) must never
 * render next to a masked subject, or a Tier-2 case leaks a named child to anyone browsing the
 * queue, safeguarding grant or not. Found 2026-08-12: `family?.label ?? guessedSenderLabel(...)`
 * rendered unconditionally, on three list views, regardless of masking state.
 */
export function senderIdentityLabel(
  shown: { masked: boolean; subject: string },
  family: { label: string } | null,
  senderEmail: string | null,
  fallback: string,
): string {
  if (shown.masked) return shown.subject;
  return family?.label ?? guessedSenderLabel(senderEmail) ?? fallback;
}

/**
 * The raw address that may sit beside the identity (2026-08-24, the email-visibility round):
 * masked in the same lockstep as senderIdentityLabel above, because an address IS an identity —
 * a Tier-2 row that hides "Parent of Aarav Shah" while printing p.aarav.shah@fsksurat.in has
 * hidden nothing. Null means "render no address slot at all", never an empty string.
 */
export function senderAddressLabel(
  shown: { masked: boolean },
  senderEmail: string | null,
): string | null {
  if (shown.masked) return null;
  return senderEmail || null;
}
