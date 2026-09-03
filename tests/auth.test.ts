import { describe, expect, it } from 'vitest';
import { mintSession, verifySession, SESSION_TTL_SECONDS } from '../lib/auth/cookie';
import { authMode, personaSwitchEnabled, signInDomainAllowed } from '../lib/auth/mode';
import { SCHOOL_DOMAINS } from '../core/senders';

const SECRET = 'test-secret-0123456789';
const NOW = new Date('2026-08-24T10:00:00Z');

describe('session cookie', () => {
  it('round-trips a provisioned identity', () => {
    const t = mintSession({ sub: 's-fd-fsk', email: 'A@FSKSURAT.IN', name: 'A' }, SECRET, NOW);
    const p = verifySession(t, SECRET, NOW);
    expect(p?.sub).toBe('s-fd-fsk');
    expect(p?.email).toBe('a@fsksurat.in'); // stored lowercased — Staff.email is the join key
  });

  it('round-trips the unprovisioned state (sub: null) distinctly from no session', () => {
    const t = mintSession({ sub: null, email: 'new@fwgs.in', name: 'New' }, SECRET, NOW);
    expect(verifySession(t, SECRET, NOW)?.sub).toBeNull();
  });

  it('refuses tampering, wrong secrets, garbage and expiry — null on ANY defect', () => {
    const t = mintSession({ sub: 's-x', email: 'a@fwgs.in', name: 'A' }, SECRET, NOW);
    const [v, body, mac] = t.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ sub: 's-founder', email: 'a@fwgs.in', name: 'A', iat: 0, exp: 9e9 }),
    ).toString('base64url');
    expect(verifySession(`${v}.${forgedBody}.${mac}`, SECRET, NOW)).toBeNull();
    expect(verifySession(t, 'other-secret', NOW)).toBeNull();
    expect(verifySession('v1.zzz', SECRET, NOW)).toBeNull();
    expect(verifySession('', SECRET, NOW)).toBeNull();
    expect(verifySession(t, SECRET, new Date(+NOW + (SESSION_TTL_SECONDS + 1) * 1000))).toBeNull();
  });
});

describe('authMode', () => {
  it('is google only when ALL THREE credentials are set — a half-configured gate is legacy', () => {
    expect(authMode({})).toBe('legacy');
    expect(authMode({ AUTH_GOOGLE_ID: 'x' })).toBe('legacy');
    expect(authMode({ AUTH_GOOGLE_ID: 'x', AUTH_GOOGLE_SECRET: 'y' })).toBe('legacy');
    expect(authMode({ AUTH_GOOGLE_ID: 'x', AUTH_GOOGLE_SECRET: 'y', AUTH_SECRET: 'z' })).toBe('google');
  });
});

describe('personaSwitchEnabled', () => {
  const GOOGLE = { AUTH_GOOGLE_ID: 'x', AUTH_GOOGLE_SECRET: 'y', AUTH_SECRET: 'z' };
  it('legacy mode: always on (it IS the identity system there)', () => {
    expect(personaSwitchEnabled({})).toBe(true);
  });
  it('google mode: only on the exact word true — the pilot flag with a deadline', () => {
    expect(personaSwitchEnabled(GOOGLE)).toBe(false);
    expect(personaSwitchEnabled({ ...GOOGLE, ENABLE_PERSONA_SWITCH: '1' })).toBe(false);
    expect(personaSwitchEnabled({ ...GOOGLE, ENABLE_PERSONA_SWITCH: 'true' })).toBe(true);
  });
});

describe('signInDomainAllowed', () => {
  it('accepts every domain on the estate list — the whole list, not just the primary', () => {
    for (const d of SCHOOL_DOMAINS) {
      expect(signInDomainAllowed(`someone@${d}`)).toBe(true);
      expect(signInDomainAllowed(`SOMEONE@${d.toUpperCase()}`)).toBe(true);
    }
  });
  it('refuses everything else', () => {
    expect(signInDomainAllowed('a@gmail.com')).toBe(false);
    expect(signInDomainAllowed('a@fsksurat.in.evil.com')).toBe(false);
    expect(signInDomainAllowed('no-at-sign')).toBe(false);
  });
});
