import { describe, it, expect } from 'vitest';
import { SCOPES, buildAuthUrl, parseEnv, upsertEnvVar } from '../tools/gmail-authorize';

describe('buildAuthUrl', () => {
  const base = {
    clientId: 'client-1.apps.googleusercontent.com',
    redirectUri: 'http://127.0.0.1:53682/oauth2/callback',
    state: 'st',
    codeChallenge: 'ch',
  };

  it('requests both Gmail scopes, offline access and forced consent', () => {
    const u = new URL(buildAuthUrl(base));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe(SCOPES.join(' '));
    // offline + consent is what forces Google to issue a refresh_token even on re-runs.
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(base.redirectUri);
  });

  it('passes the mailbox as login_hint only when given', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.has('login_hint')).toBe(false);
    const hinted = new URL(buildAuthUrl({ ...base, loginHint: 'desk@fountainhead.test' }));
    expect(hinted.searchParams.get('login_hint')).toBe('desk@fountainhead.test');
  });
});

describe('parseEnv', () => {
  it('reads KEY=value, strips quotes, skips comments and blanks, tolerates CRLF', () => {
    const env = parseEnv('# comment\r\nA=1\r\nB="two"\r\n\r\nC=\'three\'\nnot a line\n');
    expect(env).toEqual({ A: '1', B: 'two', C: 'three' });
  });

  it('keeps = signs inside values (DATABASE_URL query strings)', () => {
    expect(parseEnv('D=postgres://x?schema=public').D).toBe('postgres://x?schema=public');
  });
});

describe('upsertEnvVar', () => {
  it('replaces an existing line in place, leaving neighbours and comments alone', () => {
    const out = upsertEnvVar('# note\nGMAIL_REFRESH_TOKEN=old\nMAIL_SOURCE=seed\n', 'GMAIL_REFRESH_TOKEN', 'new');
    expect(out).toBe('# note\nGMAIL_REFRESH_TOKEN=new\nMAIL_SOURCE=seed\n');
  });

  it('replaces on a CRLF file without disturbing other lines', () => {
    const out = upsertEnvVar('A=1\r\nGMAIL_REFRESH_TOKEN=old\r\nB=2\r\n', 'GMAIL_REFRESH_TOKEN', 'new');
    expect(out).toContain('GMAIL_REFRESH_TOKEN=new');
    expect(out).toContain('A=1\r\n');
    expect(out).toContain('B=2');
  });

  it('appends when absent, adding the newline a hand-edited file may lack', () => {
    expect(upsertEnvVar('A=1', 'K', 'v')).toBe('A=1\nK=v\n');
    expect(upsertEnvVar('', 'K', 'v')).toBe('K=v\n');
  });

  it('does not mistake a prefix key for a match', () => {
    const out = upsertEnvVar('GMAIL_REFRESH_TOKEN_OLD=x\n', 'GMAIL_REFRESH_TOKEN', 'v');
    expect(out).toBe('GMAIL_REFRESH_TOKEN_OLD=x\nGMAIL_REFRESH_TOKEN=v\n');
  });
});
