// lib/ref.ts — reads the current high-water mark; core/ref.ts does the actual derivation.
//
// NOT closed here: two truly concurrent callers could still both read the same MAX before
// either commits. That is a pre-existing, narrower exposure the old count()-based version
// always had too — not the bug core/ref.ts's docstring explains, and not yet observed.
// Closing it needs a DB sequence or a serializable transaction; out of scope until it
// actually happens.
import { db } from '@/lib/db';
import { nextRefNumber } from '@/core/ref';

export async function nextRequestNumber(): Promise<number> {
  const top = await db.request.aggregate({ _max: { ref: true } });
  return nextRefNumber(top._max.ref);
}
