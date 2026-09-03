import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { mintSession, OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth/cookie';
import { exchangeCodeForIdentity, requestOrigin } from '@/lib/auth/google';
import { authMode, signInDomainAllowed } from '@/lib/auth/mode';

// GET /api/auth/google/callback — step 2: prove the state, trade the code for an identity,
// gate on the estate domain list, and mint the session. Being on an allowed domain never
// implies a role: an unprovisioned colleague gets a session that names them (sub: null) and
// lands on /unprovisioned, where a person decides — the same three-state shape the estate's
// other sign-ins use.
export async function GET(req: NextRequest) {
  const origin = requestOrigin(req.headers);
  const toSignin = (error: string) => {
    const res = NextResponse.redirect(new URL(`/signin?error=${error}`, origin));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  if (authMode() !== 'google') return NextResponse.redirect(new URL('/', origin));

  const url = req.nextUrl;
  if (url.searchParams.get('error')) return toSignin('denied');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const parked = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !parked || state !== parked) return toSignin('state');

  let identity;
  try {
    identity = await exchangeCodeForIdentity(origin, code);
  } catch {
    return toSignin('exchange');
  }
  // An unverified address is an address Google has not tied to its owner — refusing it is
  // the whole point of delegating sign-in.
  if (!identity.emailVerified) return toSignin('unverified');
  if (!signInDomainAllowed(identity.email)) return toSignin('domain');

  const staff = await db.staff.findUnique({ where: { email: identity.email } });
  const token = mintSession(
    { sub: staff?.id ?? null, email: identity.email, name: identity.name },
    process.env.AUTH_SECRET!,
  );

  const res = NextResponse.redirect(new URL(staff ? '/' : '/unprovisioned', origin));
  res.cookies.delete(OAUTH_STATE_COOKIE);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
