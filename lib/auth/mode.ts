// lib/auth/mode.ts — which authentication world the app is in, and the sign-in allowlist.
// No 'server-only': pure decisions over env + strings, pinned by tests.
//
// TWO MODES, resolved from configuration presence — the same activation shape the Gmail
// adapter used (config flip, not code change):
//
//   'google' — AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET + AUTH_SECRET all set. Real sign-in:
//              every staff request needs a verified session; the persona switcher becomes a
//              pilot convenience LAYERED ON TOP (estate rule: sign-in is who you are, the
//              persona is what you act as) and exists only while ENABLE_PERSONA_SWITCH=true.
//   'legacy' — anything less. Exactly the pre-sign-in behaviour: the shared-passcode
//              middleware plus the persona cookie. Production stays in this mode until the
//              OAuth client's credentials land, so shipping this code changes nothing by
//              itself.
//
// The allowlist is core/senders.ts's SCHOOL_DOMAINS — the app's ONE registered copy of the
// estate domain list (tools/check-auth-domains.mjs watches that file). A second copy here
// would be exactly the drift that script was written after.

import { SCHOOL_DOMAINS } from '@/core/senders';

export type AuthMode = 'google' | 'legacy';

export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  return env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET && env.AUTH_SECRET ? 'google' : 'legacy';
}

/** The pilot's role-switcher. Legacy mode: always available (it IS the identity system
 *  there). Google mode: only on the exact word 'true' — the estate's flag-with-a-deadline,
 *  first thing off at go-live. */
export function personaSwitchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (authMode(env) === 'legacy') return true;
  return env.ENABLE_PERSONA_SWITCH === 'true';
}

/** May this signed-in address enter at all? Domain gate ONLY — being on a school domain
 *  never implies a role (estate rule); provisioning to a Staff row is the capability gate. */
export function signInDomainAllowed(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return SCHOOL_DOMAINS.includes(domain);
}
