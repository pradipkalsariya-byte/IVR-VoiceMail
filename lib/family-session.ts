import 'server-only';
import { cookies } from 'next/headers';
import { db } from './db';

/**
 * Which FAMILY is signed in — the parent face's twin of lib/session.ts, same shape, same
 * honesty. In the prototype this is a cookie set by the family switcher, exactly like the
 * staff "Acting as" seam. In production it is the verified Google sign-in per QM-D38 —
 * p.<child>@<campus> — and the switcher is inert: a client can never assert an identity.
 *
 * Every parent action derives its family from HERE, never from a form field — and scope is
 * checked against it on reads AND writes (R3-14: knowing a reference is not permission).
 *
 * ◻ Open ruling noted in QM-D34: SD-COM threads are scoped to a STUDENT; this prototype
 * scopes to the FAMILY — one thread surface per family account, not per child. The family
 * grain is used here because Family is already the desk's channel-dedup key; the student
 * grain stays an open question in the register, not a decision this prototype has made.
 */
export const FAMILY_COOKIE = 'front_desk_family';

export async function currentFamily() {
  const jar = await cookies();
  const id = jar.get(FAMILY_COOKIE)?.value;

  const family = id ? await db.family.findUnique({ where: { id } }) : null;
  // Fall back to the first family so the face always renders in a fresh demo browser.
  return family ?? (await db.family.findFirstOrThrow({ orderBy: { label: 'asc' } }));
}
