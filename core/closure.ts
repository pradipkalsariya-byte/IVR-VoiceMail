// core/closure.ts — what QM-D18 requires before a request may close.
//
// Closure needs the complainant's satisfaction rating OR a coded reason for its absence — and it
// NEVER blocks on the rating itself, because the rating comes from outside the school (it sat at
// 54% even in the tightened year). The coded list turns the missing ~46% from an invisible gap
// into a measurable one: "asked, no reply" is expected, parents are busy; "never asked" is a
// fixable desk-process failure, and it is the only value on the list that indicates one.
//
// Pure, like everything in core/ — the server action consumes verdicts, it does not re-derive them.

export const SATISFACTION_ABSENT_REASONS = [
  { key: 'asked_no_reply', label: 'Asked — no reply', processFailure: false },
  { key: 'asked_declined', label: 'Asked — declined to rate', processFailure: false },
  { key: 'not_appropriate', label: 'Not appropriate to ask', processFailure: false },
  // The one that indicates something to fix. Reportable as a desk-process metric, never buried.
  { key: 'never_asked', label: 'Never asked', processFailure: true },
] as const;

export type SatisfactionAbsentReason = (typeof SATISFACTION_ABSENT_REASONS)[number]['key'];

export const isAbsentReason = (v: unknown): v is SatisfactionAbsentReason =>
  SATISFACTION_ABSENT_REASONS.some(r => r.key === v);

export interface ClosureInput {
  /** 1–5, or null when the complainant has not rated. */
  satisfaction: number | null;
  /** Required exactly when satisfaction is null. */
  absentReason: string | null;
  /** Switchboard slips and parked non-requests close without the satisfaction leg — nobody
   *  complained, so there is nobody to ask. */
  isSwitchboard: boolean;
}

export type ClosureVerdict =
  | { ok: true; satisfaction: number | null; absentReason: SatisfactionAbsentReason | null }
  | { ok: false; reason: string };

/** The QM-D18 gate. Every deny carries a reason a person can read — same rule as permissions. */
export function closureVerdict(input: ClosureInput): ClosureVerdict {
  const { satisfaction, absentReason, isSwitchboard } = input;

  // A switchboard slip ("connect me to Ms X") has no complainant-satisfaction leg. It still
  // closes through this gate so the exemption is recorded here, not scattered across callers.
  if (isSwitchboard) return { ok: true, satisfaction: null, absentReason: null };

  if (satisfaction != null) {
    if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
      return { ok: false, reason: `A satisfaction rating is 1–5; got ${satisfaction}.` };
    }
    // A rating AND an absence reason cannot both be true — refuse rather than silently prefer one.
    if (absentReason) {
      return { ok: false, reason: 'Record the rating or the reason it is absent — not both.' };
    }
    return { ok: true, satisfaction, absentReason: null };
  }

  if (!absentReason) {
    return {
      ok: false,
      reason:
        'Closing needs the family’s rating, or the reason there isn’t one (QM-D18). ' +
        'Pick one — "never asked" is an honest answer, and the only one that flags our own process.',
    };
  }
  if (!isAbsentReason(absentReason)) {
    return { ok: false, reason: `"${absentReason}" is not on the coded list.` };
  }
  return { ok: true, satisfaction: null, absentReason };
}
