import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { OAUTH_STATE_COOKIE } from '@/lib/auth/cookie';
import { buildAuthUrl, requestOrigin } from '@/lib/auth/google';
import { authMode } from '@/lib/auth/mode';

// GET /api/auth/google — step 1 of sign-in: park a CSRF state, hand off to Google.
export async function GET(req: NextRequest) {
  if (authMode() !== 'google') {
    return NextResponse.redirect(new URL('/', requestOrigin(req.headers)));
  }
  const origin = requestOrigin(req.headers);
  const state = randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(origin, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return res;
}
