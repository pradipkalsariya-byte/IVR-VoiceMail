// lib/auth/cookie.ts — the stateless signed session token (2026-08-24, the Google sign-in
// port). Deliberately hand-rolled and lean, matching this app's Gmail adapter ethos: one
// HMAC, one JSON payload, zero dependencies. NO 'server-only' import — that package throws
// under Vitest and this file's whole value is that its sign/verify/tamper behaviour is
// pinned by tests. It holds no secrets of its own; the secret always arrives as an argument.
//
// Token shape: v1.<base64url payload>.<base64url hmac-sha256>
// Payload: { sub: staffId | null, email, name, iat, exp }  (sub null = signed in on an
// allowed domain but not yet provisioned to a Staff row — the /unprovisioned state.)

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'front_desk_session';
export const OAUTH_STATE_COOKIE = 'front_desk_oauth_state';

/** Two weeks: long enough that the desk isn't re-consenting daily, short enough that a
 *  departed colleague's session dies on its own even if nobody deprovisions. */
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface SessionPayload {
  sub: string | null;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

export function mintSession(
  p: { sub: string | null; email: string; name: string },
  secret: string,
  now: Date = new Date(),
): string {
  const payload: SessionPayload = {
    sub: p.sub,
    email: p.email.toLowerCase(),
    name: p.name,
    iat: Math.floor(+now / 1000),
    exp: Math.floor(+now / 1000) + SESSION_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `v1.${body}.${sign(body, secret)}`;
}

/** Null on ANY defect — bad shape, bad signature, expired. A session that cannot be proven
 *  is a session that does not exist; there is no partial acceptance. */
export function verifySession(
  token: string | undefined | null,
  secret: string,
  now: Date = new Date(),
): SessionPayload | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, body, mac] = parts;
  const expected = sign(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp * 1000 <= +now) return null;
  return payload;
}
