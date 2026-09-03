// Register #5. The asymmetry is the whole design: a false "no request" HIDES real work, a false
// "carries a request" costs somebody ten seconds. Every name below is invented.
import { describe, it, expect } from 'vitest';
import { requestSignal, withoutQuotedHistory } from '../core/request-signal';
import { planIngest } from '../core/ingest';

const asks = (s: string, b = '') => requestSignal(s, b).carriesRequest;

describe('anything that asks stays in the queue', () => {
  it('a question mark is a request, whatever surrounds it', () => {
    expect(asks('Fwd: form', 'FYI — is this the right one?')).toBe(true);
  });

  it('polite Indian-English business idiom counts', () => {
    // A detector written to British English alone would park real work here.
    expect(asks('Bonafide', 'Kindly do the needful.')).toBe(true);
    expect(asks('Pending', 'Please revert at the earliest.')).toBe(true);
  });

  it('plain asks count', () => {
    for (const b of ['Please share the letter.', 'We need this confirmed today.',
                     'Could you arrange a meeting.', 'Let me know once done.']) {
      expect(asks('x', b)).toBe(true);
    }
  });

  it('an empty or unintelligible message is treated as a request, not as nothing', () => {
    // Silence is not evidence. This is the case that would otherwise hide work silently.
    expect(asks('', '')).toBe(true);
    expect(asks('Re:', 'asdkjh')).toBe(true);
  });
});

describe('only a clear hand-off is set aside', () => {
  it('an explicit FYI with no ask', () => {
    expect(asks('Parent mail', 'FYI. Forwarding the mail received today.')).toBe(false);
  });

  it('"no action needed"', () => {
    expect(asks('Notice', 'Sharing this for your records. No action needed.')).toBe(false);
  });

  it('a bare forward with nothing added', () => {
    // "someone forwards to front desk saying your query has come" — VK's own example.
    expect(asks('Fwd: Transport query', 'Fyi')).toBe(false);
  });

  it('but a forward WITH a request stays', () => {
    expect(asks('Fwd: Transport query', 'Please look into this and revert to the parent.')).toBe(true);
  });
});

describe('a question in the quoted history is not the forwarder asking', () => {
  it('ignores what the parent asked three replies down', () => {
    const body = [
      'FYI, passing this on.',
      '',
      '---------- Forwarded message ----------',
      'From: someone@example.test',
      'Can you please confirm the bus timing?',
    ].join('\n');
    expect(asks('Fwd: Bus', body)).toBe(false);
  });

  it('but keeps the colleague\u2019s own words when they added some', () => {
    const body = [
      'Could you handle this one please.',
      '---------- Forwarded message ----------',
      'From: someone@example.test',
      'Old thread.',
    ].join('\n');
    expect(asks('Fwd: Bus', body)).toBe(true);
  });

  it('never returns an empty body from the cut \u2014 that would manufacture a "no request"', () => {
    const onlyQuote = '\n---------- Forwarded message ----------\nFrom: a@b.test\nPlease help.';
    expect(withoutQuotedHistory(onlyQuote)).toContain('Please help');
  });
});

describe('the desk is always told why', () => {
  it('gives a plain-language reason either way', () => {
    for (const [s, b] of [['x', 'Please help.'], ['Fwd: y', 'Fyi'], ['', '']]) {
      expect(requestSignal(s, b).reason.length).toBeGreaterThan(15);
    }
  });
});

describe('register #5 end to end: internal mail parks only when it asks for nothing', () => {
  const ingest = (from: string, subject: string, body: string) => planIngest(
    {
      messageId: `m-${subject}-${body.length}`, threadId: `t-${subject}-${body.length}`,
      from: { name: 'A Colleague', email: from },
      recipients: ['frontdesk@fsksurat.in'],
      subject, body, sentAt: new Date('2026-08-20T04:00:00Z'), channel: 'email',
    } as never,
    {
      seenMessageIds: new Set(), threadToRequest: new Map(),
      aliasToCampus: new Map([['frontdesk@fsksurat.in', 'fsk']]), fallbackCampus: 'fsk',
      classifierName: 'rules',
    } as never,
  );
  const STAFF = 'colleague@fsksurat.in';

  it('parks a colleague forwarding something with nothing asked', () => {
    const d = ingest(STAFF, 'Fwd: Parent query', 'Fyi');
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.status).toBe('not_a_request');
    expect(d.fields.slaDueAt).toBeNull();
  });

  it('KEEPS a colleague who asks the desk to do something', () => {
    const d = ingest(STAFF, 'Fwd: Parent query', 'Please call this parent back today.');
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.status).toBe('unfiled');
    expect(d.fields.slaDueAt).not.toBeNull();
  });

  it('keeps a colleague forwarding a complaint, even worded flatly', () => {
    // The case that makes "park all internal mail" unacceptable.
    const d = ingest(STAFF, 'Fwd: Disappointed', 'Could you look into what the parent has written.');
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.status).toBe('unfiled');
  });

  it('says on the record WHY it was set aside', () => {
    const d = ingest(STAFF, 'Fwd: Notice', 'FYI, no action needed.');
    expect(d.reason).toMatch(/asks for nothing/);
  });

  it('does not apply to a parent — only internal senders', () => {
    // A parent writing "FYI my son will be absent" is still the desk's business.
    const d = ingest('p.someone@example.test', 'Absent', 'FYI, he will not come tomorrow.');
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.status).toBe('unfiled');
  });
});
