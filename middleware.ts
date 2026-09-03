// middleware.ts — a shared passcode gate for the controlled testing phase (VK, 2026-08-13).
//
// NOT real authentication. currentActor() (lib/session.ts) still has no verified identity —
// this only means a leaked or forwarded URL alone isn't enough to reach the app, while VK
// hand-picks who gets the passcode (Richa, Rashida, a couple more). Real per-user auth is
// still the eventual answer (see BACKLOG.md); this is the cheap interim step that costs the
// role-switching reviewers nothing — one prompt, once, then normal use.
//
// Off by default: if BASIC_AUTH_USER/BASIC_AUTH_PASSWORD are unset (every local dev machine),
// this is a complete no-op. Sets both or neither — a half-configured gate would be the worst
// of both worlds, refusing everyone with no way to enter.
//
// /api/health is deliberately excluded: Railway's healthcheck sends no credentials, and a
// gated health endpoint reads as a crash-looping deploy rather than a passcode prompt.
//
// /api/voicemail is excluded for the same reason, not a new one: the PBX vendor's webhook POST
// (docs/IVR-VOICEMAIL-BRIEF.md) has no way to supply this passcode, and it carries its own
// auth — the X-Voicemail-Token shared secret checked inside the route. Gating it here would
// silently 401 every real call before the route ever saw it.

import { NextResponse, type NextRequest } from 'next/server';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    const sep = decoded.indexOf(':');
    const gotUser = sep === -1 ? decoded : decoded.slice(0, sep);
    const gotPass = sep === -1 ? '' : decoded.slice(sep + 1);
    if (timingSafeEqual(gotUser, user) && timingSafeEqual(gotPass, pass)) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Front Desk — testing phase. Ask VK for the passcode.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="front-desk", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/((?!api/health|api/voicemail|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)'],
};
