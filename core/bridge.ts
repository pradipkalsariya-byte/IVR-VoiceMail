// core/bridge.ts — the parent-app bridge, pure half (QM-D34 / QM-D34(2)).
//
// QM-D34(2): "A role/office thread ≡ a queue — SD-COM's default Front Office catch-all IS the
// front desk. Builders must not stand up two tables." The Nucleus parent app (nucleus-parent/)
// is the parent's face for ALL school communication; anything its family routes to the front
// office is filed HERE, on this spine, as a normal `channel: 'app'` request — one record, two
// faces, two applications. This module validates what crosses the seam; the I/O lives in
// app/api/bridge/* and lib/bridge-push.ts.
//
// PURE. No I/O, no Prisma, no Next imports, deterministic.

import { isParentCategory } from './taxonomy';

/**
 * Shared-secret check for both directions of the bridge. Constant-time compare (same shape as
 * middleware.ts) — and absent-either-side is a refusal, never a pass: a bridge with no secret
 * configured does not exist, it is not "open".
 */
export function secretMatches(expected: string | null | undefined, got: string | null | undefined): boolean {
  if (!expected || !got || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/**
 * The parent app speaks this desk's taxonomy natively since 30-Aug-2026 (VK ratified the full
 * merged menu — nucleus-parent/lib/routing-menu.ts, whose tests import THIS file to pin the
 * seam), so the normal path is a real taxonomy key passing straight through. The two mapped
 * strings below are the pre-menu build's vocabulary — kept so an old client or a replayed
 * payload still lands sensibly. Anything else falls to 'unclassified' — the same honest
 * "needs a person to read it" default appSubmission applies, never a silent guess.
 */
const NUCLEUS_CATEGORY_MAP: Record<string, string> = {
  'Records & documents': 'certificates',
  Complaint: 'unclassified',
};

export function mapBridgeCategory(category: string | null | undefined): string {
  if (!category) return 'unclassified';
  if (NUCLEUS_CATEGORY_MAP[category]) return NUCLEUS_CATEGORY_MAP[category];
  return isParentCategory(category) ? category : 'unclassified';
}

export interface BridgeIntake {
  familyLabel: string;
  familyEmailKey: string;
  campus: string;
  category: string | null;
  subject: string;
  body: string;
  grade: string | null;
  section: string | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const str = (x: unknown): string | null => (typeof x === 'string' ? x.trim() : null);

/** A new filing crossing the seam. Same non-negotiables as submitRequest: subject and body. */
export function parseBridgeIntake(x: unknown): Parsed<BridgeIntake> {
  if (typeof x !== 'object' || x === null) return { ok: false, reason: 'Body must be a JSON object.' };
  const o = x as Record<string, unknown>;
  const familyLabel = str(o.familyLabel);
  const familyEmailKey = str(o.familyEmailKey)?.toLowerCase() ?? null;
  const campus = str(o.campus)?.toLowerCase() ?? null;
  const subject = str(o.subject);
  const body = str(o.body);
  if (!familyLabel) return { ok: false, reason: 'familyLabel is required.' };
  if (!familyEmailKey || !familyEmailKey.includes('@')) return { ok: false, reason: 'familyEmailKey must be an email address.' };
  if (!campus) return { ok: false, reason: 'campus is required.' };
  if (!subject) return { ok: false, reason: 'Give the request a few words of subject.' };
  if (!body) return { ok: false, reason: 'Say what is needed — the message is the request.' };
  if (subject.length > 200) return { ok: false, reason: 'subject is over 200 characters.' };
  return {
    ok: true,
    value: {
      familyLabel, familyEmailKey, campus, subject, body,
      category: str(o.category),
      grade: str(o.grade),
      section: str(o.section),
    },
  };
}

export type BridgeEvent =
  | { kind: 'message'; body: string }
  | { kind: 'rating'; rating: number }
  | { kind: 'escalation' };

/** A follow-up on an existing bridged request: the family replied, rated, or escalated. */
export function parseBridgeEvent(x: unknown): Parsed<BridgeEvent> {
  if (typeof x !== 'object' || x === null) return { ok: false, reason: 'Body must be a JSON object.' };
  const o = x as Record<string, unknown>;
  if (o.kind === 'message') {
    const body = str(o.body);
    if (!body) return { ok: false, reason: 'A reply needs some text.' };
    return { ok: true, value: { kind: 'message', body } };
  }
  if (o.kind === 'rating') {
    const rating = typeof o.rating === 'number' ? o.rating : NaN;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, reason: `A satisfaction rating is 1–5; got ${String(o.rating)}.` };
    }
    return { ok: true, value: { kind: 'rating', rating } };
  }
  if (o.kind === 'escalation') return { ok: true, value: { kind: 'escalation' } };
  return { ok: false, reason: 'kind must be message, rating or escalation.' };
}
