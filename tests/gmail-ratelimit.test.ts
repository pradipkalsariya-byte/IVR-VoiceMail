// Regression for the 2026-08-25 outage: the live mailbox stopped ingesting for fourteen hours
// and the only symptom was `fetched=0` on every pass — indistinguishable from a quiet night.
// Gmail was answering 429 "User-rate limit exceeded. Retry after <t>" to every call, and the
// five-minute timer kept calling. Refused requests still count against the limit, so the timer
// was holding its own penalty open.
import { describe, it, expect, beforeEach } from 'vitest';
import { GmailMailSource, gmailCooldownUntil, resetGmailCooldown } from '../lib/ingest/gmail';

const CFG = {
  mailSource: 'gmail', clientId: 'id', clientSecret: 'secret',
  refreshToken: 'refresh', query: 'to:frontdesk@fsksurat.in',
};

const tokenOk = () =>
  new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });

const rateLimited = (retryAfterIso: string) =>
  new Response(JSON.stringify({
    error: { code: 429, message: `User-rate limit exceeded.  Retry after ${retryAfterIso}`,
             status: 'RESOURCE_EXHAUSTED' },
  }), { status: 429 });

describe('Gmail 429 handling', () => {
  beforeEach(() => resetGmailCooldown());

  it('parses the retry time out of the body and refuses to call again before it', async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const calls: string[] = [];
    const http = async (url: string) => {
      calls.push(url);
      return url.includes('oauth2') ? tokenOk() : rateLimited(future);
    };
    const src = new GmailMailSource(CFG, http as never);

    await expect(src.fetch()).rejects.toThrow(/429/);
    expect(gmailCooldownUntil()).toBeGreaterThan(Date.now() + 9 * 60_000);

    // The SECOND pass must not reach the network at all — that is the whole point.
    const before = calls.length;
    await expect(src.fetch()).rejects.toThrow(/rate-limiting this account until/);
    expect(calls.length).toBe(before);
  });

  it('shares the cooldown across instances — a new tick must not walk back into it', async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const http = async (url: string) => (url.includes('oauth2') ? tokenOk() : rateLimited(future));
    await expect(new GmailMailSource(CFG, http as never).fetch()).rejects.toThrow(/429/);

    let touched = 0;
    const http2 = async (url: string) => { touched++; return url.includes('oauth2') ? tokenOk() : rateLimited(future); };
    await expect(new GmailMailSource(CFG, http2 as never).fetch()).rejects.toThrow(/rate-limiting/);
    expect(touched).toBe(0);
  });

  it('falls back to a fixed cooldown when no retry time is given', async () => {
    const http = async (url: string) => url.includes('oauth2')
      ? tokenOk()
      : new Response('{}', { status: 429 });
    await expect(new GmailMailSource(CFG, http as never).fetch()).rejects.toThrow(/429/);
    // ~15 minutes, not zero — a 429 with no guidance must still back off.
    expect(gmailCooldownUntil()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('says plainly that nothing is lost, so a reader does not go hunting for missing mail', async () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    const http = async (url: string) => (url.includes('oauth2') ? tokenOk() : rateLimited(future));
    const src = new GmailMailSource(CFG, http as never);
    await expect(src.fetch()).rejects.toThrow(/429/);
    await expect(src.fetch()).rejects.toThrow(/Nothing is lost/);
  });

  it('lets a normal failure through untouched — only 429 arms the cooldown', async () => {
    const http = async (url: string) => url.includes('oauth2')
      ? tokenOk()
      : new Response('nope', { status: 500 });
    await expect(new GmailMailSource(CFG, http as never).fetch()).rejects.toThrow(/failed \(500\)/);
    expect(gmailCooldownUntil()).toBe(0);
  });
});
