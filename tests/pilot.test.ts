import { describe, it, expect } from 'vitest';
import { pilotConfigFromEnv, emailEnvelope } from '../core/pilot';

describe('pilotConfigFromEnv', () => {
  it('is off by default — no env means no redirect, ever', () => {
    expect(pilotConfigFromEnv({})).toEqual({ enabled: false, reviewerEmail: null, ccEmails: [] });
  });

  it('reads the full config when set', () => {
    const cfg = pilotConfigFromEnv({
      PILOT_MODE: 'true',
      PILOT_REVIEWER_EMAIL: ' richa.panchal@fsksurat.in ',
      PILOT_CC_EMAILS: 'vardan.kabra@fountainheadschools.org, jatin.chadha@fountainheadschools.org',
    });
    expect(cfg).toEqual({
      enabled: true,
      reviewerEmail: 'richa.panchal@fsksurat.in',
      ccEmails: ['vardan.kabra@fountainheadschools.org', 'jatin.chadha@fountainheadschools.org'],
    });
  });

  it('only "true" (the literal string) turns it on — no truthy-string surprises', () => {
    expect(pilotConfigFromEnv({ PILOT_MODE: '1' }).enabled).toBe(false);
    expect(pilotConfigFromEnv({ PILOT_MODE: 'yes' }).enabled).toBe(false);
  });

  it('tolerates a missing or empty cc list', () => {
    expect(pilotConfigFromEnv({ PILOT_MODE: 'true', PILOT_REVIEWER_EMAIL: 'r@x.test' }).ccEmails).toEqual([]);
  });
});

describe('emailEnvelope', () => {
  const REAL = 'p.aarav.shah@fsksurat.in';
  const off = { enabled: false, reviewerEmail: null, ccEmails: [] };
  const on = { enabled: true, reviewerEmail: 'richa.panchal@fsksurat.in', ccEmails: ['vk@x.test', 'jatin@x.test'] };

  it('is a pure passthrough to the real family when pilot mode is off', () => {
    const env = emailEnvelope(REAL, 'Bus stop', 'We checked.', off);
    expect(env).toEqual({ to: [REAL], cc: [], subject: 'Bus stop', body: 'We checked.', redirected: false });
  });

  it('never puts the real family address in To or Cc when pilot mode is on', () => {
    const env = emailEnvelope(REAL, 'Bus stop', 'We checked.', on);
    expect(env.to).toEqual(['richa.panchal@fsksurat.in']);
    expect(env.cc).toEqual(['vk@x.test', 'jatin@x.test']);
    expect(env.to).not.toContain(REAL);
    expect(env.cc).not.toContain(REAL);
  });

  it('names the real intended recipient inside the body, and marks the subject, when redirected', () => {
    const env = emailEnvelope(REAL, 'Bus stop', 'We checked.', on);
    expect(env.body).toContain(REAL);
    expect(env.body).toContain('We checked.');
    expect(env.subject).toBe('[PILOT] Bus stop');
    expect(env.redirected).toBe(true);
  });

  it('treats "enabled but no reviewer configured" as off, not as a crash', () => {
    const env = emailEnvelope(REAL, 'Bus stop', 'We checked.', { enabled: true, reviewerEmail: null, ccEmails: [] });
    expect(env).toEqual({ to: [REAL], cc: [], subject: 'Bus stop', body: 'We checked.', redirected: false });
  });
});
