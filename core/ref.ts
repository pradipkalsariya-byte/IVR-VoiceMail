// core/ref.ts — derive the next FD-NNNN reference number from the current high-water mark.
// PURE: takes the max ref already read from the database, does not read it itself.
//
// The bug this exists to prevent (found 2026-08-12): every call site derived the next number
// from `db.request.count()`, which only equals "highest ref + 1" while the table is strictly
// append-only. The first time any row was ever deleted (cleaning up an unrelated duplicate-
// explosion bug), count() undershot the true high-water mark and the next batch of newly
// generated refs collided with still-existing high-numbered rows, failing Prisma's unique
// constraint on `ref` mid live-ingest. MAX(ref) survives deletion; count() does not.

/** Refs are always 4-digit zero-padded ("FD-0064"), so lexical MAX and numeric MAX agree —
 *  a plain SQL MAX() on the string column is a correct, index-friendly high-water mark. */
export function nextRefNumber(maxRef: string | null): number {
  return maxRef ? parseInt(maxRef.slice(3), 10) + 1 : 1;
}
