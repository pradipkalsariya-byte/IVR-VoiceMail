import { describe, it, expect } from 'vitest';
import {
  APP_ACK_TARGET_WORKING_HOURS, planIngest, resolveCampus,
  type IngestContext, type IngestInput,
} from '../core/ingest';
import { addWorkingHours } from '../core/sla';
import { FAKE_APP_SUBMISSIONS, FakeMailSource, FakeMailSender, appSubmission, msg } from '../lib/ingest/fake';
import { GmailMailSource, GmailMailSender } from '../lib/ingest/gmail';

const ALIASES = new Map([
  ['frontdesk@fsksurat.in', 'fsk'],
  ['frontdesk@fountainheadschools.org', 'fsk'],
  ['frontdesk@fwgs.in', 'fwgs'],
]);

const ctx = (over: Partial<IngestContext> = {}): IngestContext => ({
  seenMessageIds: new Set(),
  threadToRequest: new Map(),
  aliasToCampus: ALIASES,
  fallbackCampus: 'fsk',
  ...over,
});

const inbound = (over: Partial<IngestInput> = {}): IngestInput => ({
  messageId: '<m1@test>',
  threadId: 't1',
  from: { name: 'Parents of A Child', email: 'p.a.child@fsksurat.in' },
  recipients: ['frontdesk@fsksurat.in'],
  subject: 'Request for bonafide certificate',
  body: 'Kindly issue a bonafide certificate for my ward.',
  sentAt: new Date('2026-08-06T04:30:00Z'), // 10:00 IST, inside desk hours
  deliveredTo: 'frontdesk@fsksurat.in',
  ...over,
});

describe('campus resolution', () => {
  it('uses Delivered-To when it matches a monitored alias', () => {
    expect(resolveCampus({ deliveredTo: 'frontdesk@fwgs.in', recipients: [] }, ALIASES, 'fsk'))
      .toEqual({ campus: 'fwgs', how: 'Delivered-To frontdesk@fwgs.in' });
  });

  it('falls back to a recipient when Delivered-To is absent', () => {
    const r = resolveCampus({ recipients: ['someone@x.test', 'frontdesk@fwgs.in'] }, ALIASES, 'fsk');
    expect(r.campus).toBe('fwgs');
  });

  it('treats the two FSK addresses as the same campus', () => {
    // frontdesk@fsksurat.in and frontdesk@fountainheadschools.org are one group, two addresses.
    expect(resolveCampus({ deliveredTo: 'frontdesk@fountainheadschools.org', recipients: [] }, ALIASES, 'x').campus)
      .toBe('fsk');
  });

  it('falls back when only a founder was written to — 44% of real parent mail', () => {
    const r = resolveCampus({ recipients: ['founder@fountainheadschools.org'] }, ALIASES, 'fsk');
    expect(r.campus).toBe('fsk');
    expect(r.how).toMatch(/no monitored desk address matched/);
  });

  it('is case-insensitive about addresses', () => {
    expect(resolveCampus({ deliveredTo: 'FrontDesk@FWGS.in', recipients: [] }, ALIASES, 'fsk').campus)
      .toBe('fwgs');
  });
});

describe('idempotency — the whole reason polling is safe', () => {
  it('skips a Message-ID already stored', () => {
    const d = planIngest(inbound(), ctx({ seenMessageIds: new Set(['<m1@test>']) }));
    expect(d.action).toBe('skip-duplicate');
  });

  it('creates when unseen', () => {
    expect(planIngest(inbound(), ctx()).action).toBe('create');
  });

  it('appends to an existing request when the thread is already tracked', () => {
    const d = planIngest(inbound({ messageId: '<m2@test>' }), ctx({
      threadToRequest: new Map([['t1', 'req-1']]),
    }));
    expect(d).toMatchObject({ action: 'append-to-thread', requestId: 'req-1' });
  });

  it('prefers skip over append when both would apply', () => {
    const d = planIngest(inbound(), ctx({
      seenMessageIds: new Set(['<m1@test>']),
      threadToRequest: new Map([['t1', 'req-1']]),
    }));
    expect(d.action).toBe('skip-duplicate');
  });
});

describe('automated senders are parked, not queued', () => {
  const auto = (over: Partial<IngestInput>) => planIngest(inbound({
    messageId: `<auto-${Math.random()}@test>`, ...over,
  }), ctx());

  it('parks a Student Exit Pass notification', () => {
    const d = auto({
      from: { name: 'Student Exit Pass', email: 'forms@fsksurat.in' },
      subject: 'Student Exit Pass - New Form filled for A Child',
    });
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isAutomated).toBe(true);
    expect(d.fields.status).toBe('not_a_request');
    expect(d.fields.slaDueAt).toBeNull();
    expect(d.reason).toMatch(/Parked out of the working queue/);
  });

  it('parks the Nucleus sickbay notifier', () => {
    const d = auto({
      from: { name: 'Nucleus-Sickbay visit - student', email: 'donotreply@fsksurat.in' },
      subject: 'A Child has visited sickbay.',
    });
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.senderKind).toBe('machine');
    expect(d.fields.slaDueAt).toBeNull();
  });

  it('parks a vendor blast, and records why', () => {
    const d = auto({
      from: { name: 'A Vendor', email: 'sales@vendor.test' },
      subject: 'Introducing our platform — book a demo',
      body: 'Our proposal, pricing attached.',
    });
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isVendorNoise).toBe(true);
    expect(d.fields.status).toBe('not_a_request');
  });

  it('does NOT park a parent, and gives them a clock', () => {
    const d = auto({});
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isAutomated).toBe(false);
    expect(d.fields.status).toBe('unfiled');
    expect(d.fields.slaDueAt).toBeInstanceOf(Date);
    expect(d.fields.category).toBeNull(); // untriaged until a human files it
  });
});

describe('fields carried onto the request', () => {
  it('records the recipient sprawl as evidence', () => {
    const to = ['frontdesk@fsksurat.in', 'founder@fountainheadschools.org', 'directors@fountainheadschools.org'];
    const d = planIngest(inbound({ recipients: to }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.originalRecipients).toEqual(to);
  });

  it('starts the clock at desk-open for mail arriving before it', () => {
    // 06:30 IST — inside the 26% morning peak, before the desk is staffed.
    const d = planIngest(inbound({ sentAt: new Date('2026-08-06T01:00:00Z') }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(+d.fields.clockStartsAt).toBeGreaterThan(+d.fields.arrivedAt);
  });

  it('flags safeguarding content and makes it critical', () => {
    const d = planIngest(inbound({
      subject: 'Serious concern: child left unattended at the bus stop',
    }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isSafeguarding).toBe(true);
    expect(d.fields.urgency).toBe('critical');
  });

  it('flags switchboard traffic without parking it', () => {
    const d = planIngest(inbound({ subject: 'Mother wanted to speak to the class teacher' }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isSwitchboard).toBe(true);
    expect(d.fields.status).toBe('unfiled'); // still real work, just labelled
  });

  it('always carries a suggestion reason', () => {
    const d = planIngest(inbound({ subject: '' }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.suggestionReason.length).toBeGreaterThan(10);
  });

  it('email items carry channel email, no ack clock, and a family key for a parent', () => {
    const d = planIngest(inbound(), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.channel).toBe('email');
    // The email rail's acknowledgement clock fires on FILING (QM-D12), a human act that has
    // not happened yet at ingest — so nothing may be stamped here.
    expect(d.fields.ackDueAt).toBeNull();
    expect(d.fields.familyEmailKey).toBe('p.a.child@fsksurat.in');
  });
});

// QM-D34 (2026-08-07): the in-app rail is the PRIMARY parent surface, and it arrives
// PRE-ROUTED — the parent picked the category from the deterministic menu (SD-COM-3,
// concierge suggest-only). Per QM-D34(5) submission IS filing on this channel.
describe('the app channel — pre-routed, so submission is filing (QM-D34)', () => {
  const sub = (over: Partial<IngestInput> = {}) => appSubmission({
    subject: 'Bonafide certificate for a visa appointment',
    body: 'Please issue a bonafide for Alpha Sample (FSK2099481).',
    sentAt: new Date('2026-08-06T05:00:00Z'), // 10:30 IST, inside desk hours
    appCategory: 'certificates',
    campusOrgUnitId: 'fwgs',
    ...over,
  });

  it('lands open, categorised by the parent, with both clocks running', () => {
    const d = planIngest(sub(), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.channel).toBe('app');
    expect(d.fields.status).toBe('open');           // no unfiled stop — filing already happened
    expect(d.fields.category).toBe('certificates'); // the parent's pick
    expect(d.fields.slaDueAt).toBeInstanceOf(Date);
    expect(d.fields.ackDueAt).toBeInstanceOf(Date);
    expect(d.reason).toMatch(/submission is filing/i);
  });

  it('stamps the acknowledgement clock from the submission instant, desk-hours adjusted', () => {
    const sentAt = new Date('2026-08-07T01:00:00Z'); // 06:30 IST — before the desk opens
    const d = planIngest(sub({ sentAt }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.ackDueAt).toEqual(addWorkingHours(sentAt, APP_ACK_TARGET_WORKING_HOURS));
    // Pre-dawn submission: the target must sit after the opening bell, not 07:30 IST.
    expect(+d.fields.ackDueAt!).toBeGreaterThan(+sentAt);
  });

  it('takes the campus from the signed-in context, not address inference', () => {
    const d = planIngest(sub(), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.campusOrgUnitId).toBe('fwgs'); // no recipients, no Delivered-To involved
  });

  it('falls back rather than trusting an unrecognised campus id from the client', () => {
    const d = planIngest(sub({ campusOrgUnitId: 'not-a-campus' }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.campusOrgUnitId).toBe('fsk');
  });

  it('drops a pick from outside the menu to unclassified — visible, never silently adopted', () => {
    const d = planIngest(sub({ appCategory: 'no-such-category' }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.category).toBe('unclassified');
    expect(d.fields.status).toBe('open'); // still filed — the parent did their part
  });

  it('keeps the pick as routing, not final classification — the classifier may dissent', () => {
    const d = planIngest(sub({
      subject: 'Refund for the term 2 instalment',
      body: 'The fee receipt shows a double payment.',
      appCategory: 'meetings', // the parent picked the wrong door
    }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.category).toBe('meetings');        // the pick is honoured (human-editable)
    expect(d.fields.suggestedCategory).toBe('fees');   // the dissent stays visible at triage
    expect(d.fields.suggestionReason.length).toBeGreaterThan(10); // mandatory reason (AI-15)
  });

  it('pre-routing never bypasses content-based safeguarding (R3-18)', () => {
    const d = planIngest(sub({
      subject: 'Bus 12 dropped at the wrong stop again',
      body: 'She walked home alone.',
      appCategory: 'transport',
    }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isSafeguarding).toBe(true);
    expect(d.fields.urgency).toBe('critical');
  });

  it('is idempotent like every other rail — duplicate skips, thread reply appends', () => {
    const first = sub({ messageId: '<app-1@test>', threadId: 'app-t1' });
    expect(planIngest(first, ctx({ seenMessageIds: new Set(['<app-1@test>']) })).action)
      .toBe('skip-duplicate');
    const reply = sub({ messageId: '<app-2@test>', threadId: 'app-t1' });
    expect(planIngest(reply, ctx({ threadToRequest: new Map([['app-t1', 'req-9']]) })))
      .toMatchObject({ action: 'append-to-thread', requestId: 'req-9' });
  });

  it('ships three synthetic fixtures so the demo shows the channel', () => {
    expect(FAKE_APP_SUBMISSIONS).toHaveLength(3);
    for (const s of FAKE_APP_SUBMISSIONS) {
      expect(s.channel).toBe('app');
      expect(s.appCategory).toBeTruthy();
      expect(s.from.name).toMatch(/Sample/); // NATO-set identities only (cardinal rule 2)
      const d = planIngest(s, ctx());
      if (d.action !== 'create') throw new Error('expected create');
      expect(d.fields.status).toBe('open');
      expect(d.fields.ackDueAt).toBeInstanceOf(Date);
    }
  });
});

// QM-D40 (2026-08-07): an a<graduation-year>. sender is an ALUMNUS — the s. account renamed at
// graduation, not a current student. No enrolment, no guardian to notify, no campus by posting.
describe('alumni handling (QM-D40)', () => {
  const alum = (over: Partial<IngestInput> = {}) => inbound({
    messageId: `<alum-${Math.random()}@test>`,
    threadId: `alum-t-${Math.random()}`,
    from: { name: 'Alpha Sample', email: 'a2099.alpha.sample@fsksurat.in' },
    subject: 'Transcript for university verification',
    body: 'I need my Grade 12 transcript attested for a university application.',
    ...over,
  });

  it('creates no Family link — familyEmailKey stays null, unlike a parent', () => {
    const d = planIngest(alum(), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.senderKind).toBe('alumnus');
    // An alumnus has NO Family record and none may be synthesised for them: nobody to notify,
    // no campus by posting. The write layer only ever LINKS by this key, so null = no Family.
    expect(d.fields.familyEmailKey).toBeNull();
  });

  it('suggests certificates for record-and-verification language — the EXC-5 lean', () => {
    const d = planIngest(alum({
      subject: 'Marks verification needed',
      body: 'My employer needs my marks verified.', // "marks" alone would fall into Academic
    }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.suggestedCategory).toBe('certificates');
    expect(d.fields.suggestionReason).toMatch(/alumni traffic is disproportionately certificate requests \(EXC-5 path\)/);
    // A suggestion is all it is — an unfiled item still waits for a human (AI-13).
    expect(d.fields.status).toBe('unfiled');
    expect(d.fields.category).toBeNull();
  });

  it('never lets the alumni lean shadow safeguarding', () => {
    const d = planIngest(alum({
      subject: 'My younger brother was left unattended at the gate while I collected my certificate',
    }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.suggestedCategory).toBe('child-safety');
    expect(d.fields.isSafeguarding).toBe(true);
  });

  it('never vendor-parks an alumnus — an authenticated school account is not a cold blast', () => {
    const d = planIngest(alum({
      subject: 'Certificate for my sports award', // "award" is in the VENDOR pattern
      body: 'Need the certificate attested.',
    }), ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isVendorNoise).toBe(false);
    expect(d.fields.status).toBe('unfiled'); // in the triage pile, not the bin
  });
});

describe('the fake source, used by every other test', () => {
  it('filters by since and honours limit', async () => {
    const src = new FakeMailSource([
      msg({ subject: 'old', sentAt: new Date('2026-08-01T00:00:00Z') }),
      msg({ subject: 'new1', sentAt: new Date('2026-08-05T00:00:00Z') }),
      msg({ subject: 'new2', sentAt: new Date('2026-08-06T00:00:00Z') }),
    ]);
    expect(await src.fetch({ since: new Date('2026-08-04T00:00:00Z') })).toHaveLength(2);
    expect(await src.fetch({ limit: 1 })).toHaveLength(1);
    expect(src.fetchCalls).toHaveLength(2);
  });

  it('records what a sender was asked to send', async () => {
    const s = new FakeMailSender();
    await s.reply({
      threadId: 't1', inReplyToMessageId: '<a@x>', to: ['p@x.test'],
      subject: 'Bonafide', body: 'On its way.', fromAlias: 'Front Desk <frontdesk@fsksurat.in>',
    });
    expect(s.sent[0]).toMatchObject({ threadId: 't1', fromAlias: 'Front Desk <frontdesk@fsksurat.in>' });
  });
});

describe('Gmail adapter gating — fails closed, never silently empty', () => {
  const full = {
    mailSource: 'gmail', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh',
  };

  it('refuses when MAIL_SOURCE is not gmail', async () => {
    const s = new GmailMailSource({ ...full, mailSource: 'seed' });
    const r = await s.isReady();
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/MAIL_SOURCE=gmail/);
  });

  it('names every missing credential', async () => {
    const r = await new GmailMailSource({ mailSource: 'gmail' }).isReady();
    expect(r.reason).toMatch(/GMAIL_CLIENT_ID/);
    expect(r.reason).toMatch(/GMAIL_CLIENT_SECRET/);
    expect(r.reason).toMatch(/GMAIL_REFRESH_TOKEN/);
  });

  it('is ready when all four gates are present', async () => {
    expect((await new GmailMailSource(full).isReady()).ready).toBe(true);
  });

  it('throws rather than returning [] when not activated', async () => {
    await expect(new GmailMailSource({ mailSource: 'seed' }).fetch()).rejects.toThrow(/not activated/);
  });

  it('refuses to send without a Send-as alias', async () => {
    const r = await new GmailMailSender(full).isReady();
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/GMAIL_SEND_AS/);
  });

  it('is ready to send once the alias is configured', async () => {
    const r = await new GmailMailSender({ ...full, sendAsAlias: 'Front Desk <frontdesk@fsksurat.in>' }).isReady();
    expect(r.ready).toBe(true);
  });
});

describe('Gmail adapter over a fake transport — no network', () => {
  const RAW = [
    'Message-ID: <real-1@fsksurat.in>',
    'From: "Parents of A Child" <p.a.child@fsksurat.in>',
    'To: frontdesk@fsksurat.in, founder@fountainheadschools.org',
    'Subject: =?UTF-8?Q?Request=20for=20bonafide?=',
    'Date: Thu, 6 Aug 2026 10:00:00 +0530',
    'Delivered-To: frontdesk@fsksurat.in',
    'Content-Type: multipart/alternative; boundary="BB"',
    '',
    '--BB',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Kindly issue a bonafide=20certificate.',
    '--BB',
    'Content-Type: text/html',
    '',
    '<p>Kindly issue a bonafide certificate.</p>',
    '--BB--',
  ].join('\r\n');

  const b64url = (s: string) =>
    Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const transport = (): typeof fetch => (async (url: string) => {
    const u = String(url);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes('oauth2.googleapis.com')) return json({ access_token: 'tok', expires_in: 3600 });
    if (u.includes('/messages?')) return json({ messages: [{ id: 'g1' }] });
    if (u.includes('/messages/g1')) return json({ id: 'g1', threadId: 'thr-9', raw: b64url(RAW) });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  it('decodes a real-shaped message through core/rfc822', async () => {
    const src = new GmailMailSource(
      { mailSource: 'gmail', clientId: 'i', clientSecret: 's', refreshToken: 'r' },
      transport(),
    );
    const [m] = await src.fetch();
    expect(m.messageId).toBe('<real-1@fsksurat.in>');
    expect(m.threadId).toBe('thr-9');
    expect(m.subject).toBe('Request for bonafide');            // RFC 2047 decoded
    expect(m.body).toContain('bonafide certificate');           // quoted-printable decoded
    expect(m.body).not.toContain('<p>');                        // preferred text/plain
    expect(m.from.email).toBe('p.a.child@fsksurat.in');
    expect(m.recipients).toEqual(['frontdesk@fsksurat.in', 'founder@fountainheadschools.org']);
    expect(m.deliveredTo).toBe('frontdesk@fsksurat.in');
  });

  it('sends a real reply with the exact headers a thread needs, Cc included when given', async () => {
    let posted: { url: string; body: string } | null = null;
    const sendTransport = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      if (u.includes('/messages/send')) {
        posted = { url: u, body: String(init?.body ?? '') };
        return new Response(JSON.stringify({ id: 'sent-1' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const sender = new GmailMailSender(
      { mailSource: 'gmail', clientId: 'i', clientSecret: 's', refreshToken: 'r', sendAsAlias: 'Front Desk <frontdesk@fsksurat.in>' },
      sendTransport,
    );
    const result = await sender.reply({
      threadId: 'thr-9', inReplyToMessageId: '<real-1@fsksurat.in>',
      to: ['richa.panchal@fsksurat.in'], cc: ['vk@x.test', 'jatin@x.test'],
      subject: '[PILOT] Bonafide', body: 'On its way.',
      fromAlias: 'Front Desk <frontdesk@fsksurat.in>',
    });

    expect(result.sentMessageId).toBe('<gmail-sent-1@local>');
    // `as`, not a plain reference: TS's flow analysis tracks `posted` as unconditionally `null`
    // across the whole function — it doesn't see the closure's reassignment as a real
    // possibility — so a plain narrowing check on it (even re-bound through an annotated const)
    // still collapses to `never`. The cast is the escape hatch from that incorrect narrowing.
    const captured = posted as { url: string; body: string } | null;
    if (!captured) throw new Error('nothing was posted');
    const { raw, threadId } = JSON.parse(captured.body) as { raw: string; threadId: string };
    expect(threadId).toBe('thr-9');
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(mime).toContain('From: Front Desk <frontdesk@fsksurat.in>');
    expect(mime).toContain('To: richa.panchal@fsksurat.in');
    expect(mime).toContain('Cc: vk@x.test, jatin@x.test');
    expect(mime).toContain('Subject: Re: [PILOT] Bonafide'); // "Re: " prepended once, not doubled
    expect(mime).toContain('In-Reply-To: <real-1@fsksurat.in>');
    expect(mime).toContain('On its way.');
  });

  it('omits the Cc header entirely rather than sending it empty when there is no cc', async () => {
    let posted = '';
    const sendTransport = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      posted = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 'sent-2' }), { status: 200 });
    }) as unknown as typeof fetch;
    const sender = new GmailMailSender(
      { mailSource: 'gmail', clientId: 'i', clientSecret: 's', refreshToken: 'r', sendAsAlias: 'Front Desk <frontdesk@fsksurat.in>' },
      sendTransport,
    );
    await sender.reply({
      threadId: 't', inReplyToMessageId: '<a@x>', to: ['p@x.test'],
      subject: 'Bonafide', body: 'On its way.', fromAlias: 'Front Desk <frontdesk@fsksurat.in>',
    });
    const { raw } = JSON.parse(posted) as { raw: string };
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(mime).not.toContain('Cc:');
  });

  it('plans that fetched message straight into a request', async () => {
    const src = new GmailMailSource(
      { mailSource: 'gmail', clientId: 'i', clientSecret: 's', refreshToken: 'r' },
      transport(),
    );
    const [m] = await src.fetch();
    const d = planIngest(m, ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.campusOrgUnitId).toBe('fsk');
    expect(d.fields.senderKind).toBe('parent');
    expect(d.fields.suggestedCategory).toBe('certificates');
    expect(d.fields.sourceThreadId).toBe('thr-9');
  });
});
