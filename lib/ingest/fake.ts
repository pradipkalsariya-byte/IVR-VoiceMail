// lib/ingest/fake.ts — in-memory MailSource/MailSender for tests.
//
// Lets the whole ingestion path be exercised without a network, a mailbox or credentials,
// which is the only reason the Gmail adapter can be written before either exists.

import type { FetchOptions, IncomingMessage, MailSender, MailSource } from './types';

export class FakeMailSource implements MailSource {
  readonly name = 'fake';
  public fetchCalls: FetchOptions[] = [];

  constructor(private messages: IncomingMessage[], private ready = true) {}

  async isReady() {
    return this.ready
      ? { ready: true, reason: 'fake source is always ready' }
      : { ready: false, reason: 'fake source configured as not ready' };
  }

  async fetch(opts: FetchOptions = {}): Promise<IncomingMessage[]> {
    this.fetchCalls.push(opts);
    let out = [...this.messages].sort((a, b) => +a.sentAt - +b.sentAt);
    if (opts.since) out = out.filter(m => +m.sentAt > +opts.since!);
    if (opts.limit != null) out = out.slice(0, opts.limit);
    return out;
  }

  /** Simulate new mail arriving between polls. */
  push(...m: IncomingMessage[]) { this.messages.push(...m); }
}

export class FakeMailSender implements MailSender {
  readonly name = 'fake';
  public sent: Array<Record<string, unknown>> = [];

  constructor(private ready = true) {}

  async isReady() {
    return this.ready
      ? { ready: true, reason: 'fake sender is always ready' }
      : { ready: false, reason: 'fake sender configured as not ready' };
  }

  async reply(args: Parameters<MailSender['reply']>[0]) {
    this.sent.push(args);
    return { sentMessageId: `<fake-${this.sent.length}@test>` };
  }

  async sendNew(args: Parameters<MailSender['sendNew']>[0]) {
    this.sent.push(args);
    return { sentMessageId: `<fake-${this.sent.length}@test>` };
  }
}

/** Build an IncomingMessage with sensible defaults, for terse test fixtures. */
export function msg(p: Partial<IncomingMessage> & { subject: string; sentAt: Date }): IncomingMessage {
  return {
    messageId: p.messageId ?? `<${Math.random().toString(36).slice(2)}@test>`,
    threadId: p.threadId ?? `t-${Math.random().toString(36).slice(2)}`,
    from: p.from ?? { name: 'Parents of A Child', email: 'p.a.child@fsksurat.in' },
    recipients: p.recipients ?? ['frontdesk@fsksurat.in'],
    subject: p.subject,
    body: p.body ?? '',
    sentAt: p.sentAt,
    deliveredTo: p.deliveredTo ?? 'frontdesk@fsksurat.in',
    channel: p.channel,
    appCategory: p.appCategory,
    campusOrgUnitId: p.campusOrgUnitId,
  };
}

/** An app-rail submission (QM-D34): pre-routed, no mailbox addresses involved. */
export function appSubmission(p: Partial<IncomingMessage> & {
  subject: string; sentAt: Date; appCategory: string;
}): IncomingMessage {
  return {
    messageId: p.messageId ?? `<app-${Math.random().toString(36).slice(2)}@test>`,
    threadId: p.threadId ?? `app-thr-${Math.random().toString(36).slice(2)}`,
    from: p.from ?? { name: 'Parents of Alpha Sample', email: 'p.alpha.sample@fsksurat.in' },
    recipients: p.recipients ?? [], // in-app — there is no To/Cc sprawl on this rail
    subject: p.subject,
    body: p.body ?? '',
    sentAt: p.sentAt,
    channel: 'app',
    appCategory: p.appCategory,
    campusOrgUnitId: p.campusOrgUnitId ?? 'fsk',
  };
}

/**
 * Synthetic app submissions, shared by tests and the demo source so "Pull mail" shows the
 * channel end-to-end. SYNTHETIC ONLY (cardinal rule 2): NATO-set identities, student ids from
 * the reserved joining-year-2099 range. Message ids are STABLE so a second pull skips them —
 * idempotency is the property worth demonstrating.
 *
 * The second fixture is deliberate: the parent filed it under "transport", but the text is a
 * safeguarding case — proving that pre-routing never bypasses content-based safeguarding
 * detection (R3-18: content-based, never flag-based).
 */
/**
 * One Enjay Synapse missed-call report for the demo batch, so "Pull mail" shows the QM-D14
 * explosion end-to-end: the report mail parks as machine traffic, and its rows land as
 * per-call capture records in "Needs filing".
 *
 * SHAPE is faithful to the real reports (validated 2026-08-08): the vendor's 'callback'
 * layout as an HTML table in `bodyHtml`, with a prose-only `body` exactly as the real
 * multipart/alternative mails carry. CONTENT is synthetic per cardinal rule 2 — every caller
 * number is from the reserved 9900000xxx block. One row is already "Callback Done", so the
 * demo also shows a call the desk does NOT get handed twice. Stable Message-ID, same as every
 * demo fixture: the derived row ids inherit it, so a second pull creates nothing.
 */
const fakeReportRow = (source: string, at: string, status: string, callbackAt = '') =>
  `<tr><td>${source}</td><td>2001</td><td>${at}</td><td>${status}</td><td>${callbackAt}</td></tr>`;

export const FAKE_MISSED_CALL_REPORT: IncomingMessage = {
  messageId: '<demo-missed-call-1@synapse.test>',
  // The real reports arrive on ONE rolling thread (775 messages over years) — kept distinct
  // here so the demo shows a report appending cleanly if a second fixture ever joins it.
  threadId: 'demo-thr-missed-calls',
  from: { name: 'Enjay Synapse', email: 'donotreply@synapse.test' },
  recipients: ['frontdesk@fsksurat.in'],
  subject: 'Missed Call Report - Front Desk (10:00 - 10:30)',
  // Prose only, like the real text/plain alternative — the table is NOT here, deliberately.
  body: 'Missed Call Report - Front Desk. Please find the missed call details below.',
  bodyHtml: [
    '<html><body><p>Missed Call Report - Front Desk</p>',
    '<table>',
    '<tr><th>Source</th><th>Destination</th><th>Misscall Time</th>',
    '<th>Callback Status</th><th>Callback Time</th></tr>',
    fakeReportRow('919900000201', '2026-08-07 10:02:14', 'No Callback'),
    fakeReportRow('919900000202', '2026-08-07 10:11:57', 'Callback Done', '2026-08-07 10:15:02'),
    fakeReportRow('919900000203', '2026-08-07 10:19:30', 'No Callback'),
    '</table></body></html>',
  ].join('\n'),
  sentAt: new Date('2026-08-07T05:00:00Z'), // 10:30 IST — mailed at the end of its half hour
  deliveredTo: 'frontdesk@fsksurat.in',
};

export const FAKE_APP_SUBMISSIONS: IncomingMessage[] = [
  appSubmission({
    messageId: '<app-fixture-1@nucleus-app>', threadId: 'app-thr-fixture-1',
    from: { name: 'Parents of Alpha Sample', email: 'p.alpha.sample@fsksurat.in' },
    subject: 'Bonafide certificate for visa appointment',
    body: 'Please issue a bonafide certificate for Alpha Sample (FSK2099481) — the embassy appointment is next Thursday.',
    sentAt: new Date('2026-08-07T01:00:00Z'), // 06:30 IST — before desk open; clocks start at the bell
    appCategory: 'certificates', campusOrgUnitId: 'fsk',
  }),
  appSubmission({
    messageId: '<app-fixture-2@nucleus-app>', threadId: 'app-thr-fixture-2',
    from: { name: 'Parents of Bravo Sample', email: 'p.bravo.sample@fwgs.in' },
    subject: 'Bus 12 dropped at the wrong stop again',
    body: 'Bravo was dropped at the wrong stop and walked home alone. Second time this term.',
    sentAt: new Date('2026-08-07T05:10:00Z'), // 10:40 IST — inside desk hours
    appCategory: 'transport', campusOrgUnitId: 'fwgs',
  }),
  appSubmission({
    messageId: '<app-fixture-3@nucleus-app>', threadId: 'app-thr-fixture-3',
    from: { name: 'Parents of Charlie Sample', email: 'p.charlie.sample@fsksurat.in' },
    subject: 'Term 2 receipt not visible in the app',
    body: 'We paid the term 2 fees on Monday but the receipt has not appeared under payments.',
    sentAt: new Date('2026-08-07T06:20:00Z'), // 11:50 IST
    appCategory: 'fees', campusOrgUnitId: 'fsk',
  }),
];
