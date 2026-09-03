// core/phone.ts — one normalisation, every phone-matching call site. PURE.
//
// Extracted from core/missed-calls.ts (which had this inline) so the missed-call capture path,
// the QuickLog family-phone lookup, and Family.phoneKey itself can never drift into two
// different ideas of "the same number" — the exact failure mode that would make a real match
// silently miss.

/** Last 10 digits, digits only — the same key Family.phoneKey stores. Null if too short to be a real number. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}
