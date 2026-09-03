import { describe, expect, it } from 'vitest';
import {
  DOWN_AFTER_MS, TICK_INTERVAL_MS, healthSentence, mailboxHealthState, type MailboxFacts,
} from '../core/mailboxHealth';

const NOW = new Date('2026-08-24T10:00:00Z');

const base: MailboxFacts = {
  source: 'gmail',
  automationWanted: true,
  filterSet: true,
  lastTick: { startedAt: new Date(+NOW - TICK_INTERVAL_MS), finishedAt: new Date(+NOW - TICK_INTERVAL_MS + 5000), ok: true },
  lastOk: { finishedAt: new Date(+NOW - TICK_INTERVAL_MS + 5000) },
  now: NOW,
};

describe('mailboxHealthState', () => {
  it('demo source is its own state, whatever else is set', () => {
    expect(mailboxHealthState({ ...base, source: 'demo' })).toBe('demo');
  });

  it('gmail without automation is manual', () => {
    expect(mailboxHealthState({ ...base, automationWanted: false })).toBe('manual');
  });

  it('automation without a mailbox filter REFUSES rather than reading everything', () => {
    // The safety property of the whole design: an unfiltered read of a member mailbox would
    // ingest that person's entire inbox. Armed-but-unfiltered must be loud, never a default.
    expect(mailboxHealthState({ ...base, filterSet: false })).toBe('unfiltered');
    expect(healthSentence('unfiltered', null)).toContain('GMAIL_QUERY');
  });

  it('armed with no tick yet is starting', () => {
    expect(mailboxHealthState({ ...base, lastTick: null })).toBe('starting');
  });

  it('a recent successful tick is healthy', () => {
    expect(mailboxHealthState(base)).toBe('healthy');
  });

  it('a failed last tick is down', () => {
    expect(mailboxHealthState({
      ...base,
      lastTick: { startedAt: new Date(+NOW - 60_000), finishedAt: new Date(+NOW - 55_000), ok: false },
    })).toBe('down');
  });

  it('a tick that died mid-flight (no finishedAt) still counts for staleness, not silence', () => {
    // ok=false + finishedAt=null is a pass killed by a deploy or crash. Recent -> down via
    // the ok check; ancient -> down via staleness. Either way it is never 'healthy'.
    expect(mailboxHealthState({
      ...base,
      lastTick: { startedAt: new Date(+NOW - 60_000), finishedAt: null, ok: false },
    })).toBe('down');
  });

  it('a last success older than three slots is down even if it succeeded', () => {
    const old = new Date(+NOW - DOWN_AFTER_MS - 60_000);
    expect(mailboxHealthState({
      ...base,
      lastTick: { startedAt: old, finishedAt: old, ok: true },
      lastOk: { finishedAt: old },
    })).toBe('down');
  });
});

describe('healthSentence', () => {
  it('healthy names the freshness instant when given one', () => {
    expect(healthSentence('healthy', '24-Aug, 03:25 pm')).toContain('24-Aug, 03:25 pm');
  });
  it('down reassures that mail is waiting, not lost', () => {
    expect(healthSentence('down', null)).toContain('waits safely');
  });
});
