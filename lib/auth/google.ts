import 'server-only';

// lib/auth/google.ts — the OAuth code flow against Google, hand-rolled like the Gmail
// adapter (three HTTPS calls, zero dependencies). Identity comes from Google's own userinfo
// endpoint over TLS — no local JWT verification surface to get wrong.
//
// The redirect URI is DERIVED from the incoming request's origin rather than pinned in env,
// so the Railway domain and the coming custom domain both work with zero config change —
// Google enforces the exact-match against its registered list, so BOTH URIs must be
// registered on the OAuth client (the registration is the security boundary, not this
// derivation).

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export const CALLBACK_PATH = '/api/auth/google/callback';

/** The public origin of this request — Railway terminates TLS, so the proxy headers are the
 *  truth and nextUrl sees http://0.0.0.0. */
export function requestOrigin(headers: Headers): string {
  const proto = headers.get('x-forwarded-proto') ?? 'http';
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost';
  return `${proto}://${host}`;
}

export function buildAuthUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID!,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the chooser: front-desk machines are shared, and the wrong remembered
    // account signing in silently is exactly the incident the chooser prevents.
    prompt: 'select_account',
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

export interface GoogleIdentity {
  email: string;
  name: string;
  emailVerified: boolean;
}

export async function exchangeCodeForIdentity(origin: string, code: string): Promise<GoogleIdentity> {
  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      redirect_uri: `${origin}${CALLBACK_PATH}`,
      grant_type: 'authorization_code',
      code,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status}).`);
  const tok = (await tokenRes.json()) as { access_token?: string };
  if (!tok.access_token) throw new Error('Google token exchange returned no access token.');

  const infoRes = await fetch(USERINFO, {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status}).`);
  const info = (await infoRes.json()) as {
    email?: string; name?: string; email_verified?: boolean;
  };
  if (!info.email) throw new Error('Google returned no email address.');
  return {
    email: info.email.toLowerCase(),
    name: info.name || info.email,
    emailVerified: info.email_verified === true,
  };
}
