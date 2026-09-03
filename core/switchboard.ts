// core/switchboard.ts — grouping missed-call slips by who actually rang.
//
// Feedback #8 and #9, 26-Aug-2026. The raw slip list is misleading: on the day of the review it
// held 414 slips from 142 distinct numbers, so most of it was the same handful of people trying
// again. Presented as a flat list that reads as 414 jobs; grouped, it is 142 calls to make.
//
// Pure so the grouping can be tested without a database, and so the "how many people" figure on
// the page and any future report cannot disagree.

/** The caller's number, as it appears at the end of a slip's subject. */
const TRAILING_NUMBER = /(\d{10})\s*$/;

export interface CallerSlip {
  id: string;
  ref: string;
  subject: string;
  arrivedAt: Date;
  campusCode: string;
  /** Set when the number matched a family in the roster; null when it did not. */
  familyLabel: string | null;
}

export interface CallerGroup {
  /** The caller number when we could read one, else the slip's own subject. */
  key: string;
  phone: string | null;
  familyLabel: string | null;
  campusCode: string;
  calls: CallerSlip[];
  lastAt: Date;
}

/**
 * Pull the caller's number out of a slip subject ("Missed call at 14:52 — 9900000216").
 *
 * Returns null rather than guessing when the subject does not carry one — a slip logged by hand
 * through QuickLog may not have the number in its subject at all, and inventing a key for it
 * would silently merge unrelated callers into one row.
 */
export function callerPhone(subject: string): string | null {
  return subject.match(TRAILING_NUMBER)?.[1] ?? null;
}

/**
 * Group slips by caller, most recently heard from first.
 *
 * Slips with no readable number each stay their own group. That is deliberate: merging every
 * unreadable slip under one "unknown" row would present several different people as one caller
 * and hide callbacks that are genuinely owed.
 */
export function groupCallers(slips: readonly CallerSlip[]): CallerGroup[] {
  const groups = new Map<string, CallerGroup>();

  for (const s of slips) {
    const phone = callerPhone(s.subject);
    const key = phone ?? `slip:${s.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.calls.push(s);
      if (s.arrivedAt.getTime() > existing.lastAt.getTime()) existing.lastAt = s.arrivedAt;
      // A later slip may have matched the roster when an earlier one did not.
      existing.familyLabel ??= s.familyLabel;
    } else {
      groups.set(key, {
        key,
        phone,
        familyLabel: s.familyLabel,
        campusCode: s.campusCode,
        calls: [s],
        lastAt: s.arrivedAt,
      });
    }
  }

  for (const g of groups.values()) {
    g.calls.sort((a, b) => b.arrivedAt.getTime() - a.arrivedAt.getTime());
  }

  return [...groups.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/**
 * What to call this caller on screen.
 *
 * The family name when the number is on file; otherwise the number itself, which is still
 * actionable — you can ring a number you cannot name. Never "Unknown sender", which tells the
 * desk nothing it can use and reads as a failure rather than a gap in the roster.
 */
export function callerDisplayName(g: Pick<CallerGroup, 'familyLabel' | 'phone'>): string {
  return g.familyLabel ?? g.phone ?? 'Caller not recorded';
}
