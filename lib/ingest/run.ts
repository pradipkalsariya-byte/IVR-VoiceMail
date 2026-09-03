import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { nextRequestNumber } from '@/lib/ref';
import { explodeMissedCallReport, planIngest, type IngestInput } from '@/core/ingest';
import { isMissedCallReport } from '@/core/missed-calls';
import { emailVariants } from '@/core/senders';
import { GmailMailSource, gmailConfigFromEnv } from './gmail';
import { FAKE_APP_SUBMISSIONS, FAKE_MISSED_CALL_REPORT } from './fake';
import type { IncomingMessage, MailSource } from './types';

/**
 * Demo source. Produces a small batch of plausible new mail so the ingestion path can be
 * driven end-to-end before the real mailbox exists. Clearly labelled — it fabricates.
 */
class DemoMailSource implements MailSource {
  readonly name = 'demo';
  async isReady() {
    return { ready: true, reason: 'Demo source — fabricates a small batch, no mailbox needed.' };
  }
  async fetch(): Promise<IncomingMessage[]> {
    const now = Date.now();
    // STABLE message ids, deliberately. A time-based id made every pull look like fresh mail,
    // which quietly hid the thing most worth demonstrating: pull twice and the second run
    // creates nothing. Idempotency is the property that makes polling safe.
    const mk = (
      i: number, subject: string, body: string,
      from: { name: string; email: string }, to: string[],
    ): IncomingMessage => ({
      messageId: `<demo-fixture-${i}@fsksurat.in>`,
      threadId: `demo-thr-${i}`,
      from, recipients: to, subject, body,
      sentAt: new Date(now - i * 90_000),
      deliveredTo: to[0],
    });
    return [
      mk(1, 'Request for bonafide certificate',
        'Kindly issue a bonafide certificate for my ward for a passport application.',
        { name: 'Parents of A Child', email: 'p.demo.one@fsksurat.in' },
        ['frontdesk@fsksurat.in']),
      mk(2, 'Student Exit Pass - New Form filled for A Child (Grade 6) (FSK2099999)',
        'Student Exit Pass Notification. Dear PCs/FrontDesk/ THIS EMAIL IS GENERATED automatically.',
        { name: 'Student Exit Pass', email: 'forms-receipts@fsksurat.in' },
        ['frontdesk@fsksurat.in']),
      mk(3, 'Bus did not arrive at the stop this morning',
        'We waited 25 minutes and no one informed us. This is the second time this month.',
        { name: 'Parents of B Child', email: 'p.demo.two@fwgs.in' },
        ['frontdesk@fwgs.in', 'founder@fountainheadschools.org']),
      // The app rail (QM-D34) rides the same batch: pre-routed submissions that land 'open'
      // with the acknowledgement clock already running — same stable-id idempotency.
      ...FAKE_APP_SUBMISSIONS,
      // One missed-call report (QM-D14 consequence 1): the mail parks as machine traffic and
      // its rows explode into per-call captures in "Needs filing".
      FAKE_MISSED_CALL_REPORT,
    ];
  }
}

export function getMailSource(env: NodeJS.ProcessEnv = process.env): MailSource {
  if (env.MAIL_SOURCE === 'gmail') return new GmailMailSource(gmailConfigFromEnv(env));
  return new DemoMailSource();
}

export interface IngestSummary {
  source: string;
  ready: boolean;
  readyReason: string;
  fetched: number;
  created: number;
  appended: number;
  skipped: number;
  parked: number;
  errors: string[];
}

/**
 * Fetch, plan and write. Safe to run repeatedly — every decision is keyed on the RFC822
 * Message-ID, so a second run over the same window is a no-op.
 */
export async function runIngest(opts: { since?: Date; limit?: number } = {}): Promise<IngestSummary> {
  const source = getMailSource();
  const gate = await source.isReady();
  const summary: IngestSummary = {
    source: source.name, ready: gate.ready, readyReason: gate.reason,
    fetched: 0, created: 0, appended: 0, skipped: 0, parked: 0, errors: [],
  };
  if (!gate.ready) return summary;

  // Which desk address maps to which campus. Config in production; derived here so the
  // prototype works against whatever campuses are seeded.
  const campuses = await db.orgUnit.findMany({ where: { type: 'CAMPUS' }, select: { id: true, code: true } });
  const aliasToCampus = new Map<string, string>();
  for (const c of campuses) {
    aliasToCampus.set(`frontdesk@${c.code}.in`, c.id);
    aliasToCampus.set(`frontdesk@${c.code}surat.in`, c.id);
  }
  aliasToCampus.set('frontdesk@fountainheadschools.org', campuses.find(c => c.code === 'fsk')?.id ?? campuses[0].id);
  const fallbackCampus = campuses.find(c => c.code === 'fsk')?.id ?? campuses[0].id;

  let messages: IncomingMessage[] = [];
  try {
    messages = await source.fetch({ since: opts.since, limit: opts.limit ?? 100 });
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return summary;
  }
  summary.fetched = messages.length;

  const ids = messages.map(m => m.messageId);
  const threadIds = [...new Set(messages.map(m => m.threadId))];
  const [seen, threads, ledgerSeen] = await Promise.all([
    db.request.findMany({ where: { sourceMessageId: { in: ids } }, select: { id: true, sourceMessageId: true } }),
    db.request.findMany({ where: { sourceThreadId: { in: threadIds } }, select: { id: true, sourceThreadId: true } }),
    db.mailLedgerEntry.findMany({ where: { messageId: { in: ids } }, select: { messageId: true, requestId: true } }),
  ]);
  // The seen-set is Request.sourceMessageId UNION the mail ledger. The union is load-bearing:
  // only the FIRST message of a thread lands on the Request row — an APPENDED reply's id was
  // never persisted anywhere until the ledger existed, so any refetch of an already-stored
  // reply re-appended it. The five-minute tick's 6h overlap window turned that from an
  // occasional manual-pull duplicate into one copy every five minutes: found 25-Aug-2026 in
  // production as 113 replies duplicated into 2,877 excess rows (worst single reply: 74
  // copies), diagnosed from `joined=1070` against `ledger_total=288` — a join count no real
  // morning could produce.
  const seenIds = new Set([
    ...seen.map(s => s.sourceMessageId!).filter(Boolean),
    ...ledgerSeen.map(l => l.messageId),
  ]);
  const messageIdToRequest = new Map<string, string>([
    ...ledgerSeen.filter(l => l.requestId).map(l => [l.messageId, l.requestId!] as const),
    // Request-derived links win where both exist — the request row is the record of truth.
    ...seen.filter(s => s.sourceMessageId).map(s => [s.sourceMessageId!, s.id] as const),
  ]);
  const threadToRequest = new Map(threads.filter(t => t.sourceThreadId).map(t => [t.sourceThreadId!, t.id]));

  /**
   * The mail ledger (step 3, 2026-08-24): one row per processed mailbox message — the frozen
   * fact of what became of it. Upsert on the unique Message-ID with an EMPTY update: one mail
   * is one row forever, and a re-pull changes nothing (IngestRun carries per-pass counts).
   * A ledger failure is recorded and never aborts the mail itself — the request is the
   * record of truth; the ledger is the record of provenance.
   */
  const ledger = async (
    m: IncomingMessage, outcome: string, requestId: string | null, detail?: string,
  ) => {
    try {
      await db.mailLedgerEntry.upsert({
        where: { messageId: m.messageId },
        update: {},
        create: {
          id: randomUUID(), messageId: m.messageId, threadId: m.threadId || null,
          source: source.name, channel: m.channel ?? 'email',
          fromName: m.from.name || null, fromEmail: m.from.email || null,
          recipients: m.recipients, subject: m.subject,
          receivedAt: m.sentAt, processedAt: new Date(),
          outcome, detail: detail ?? null, requestId,
        },
      });
    } catch (e) {
      summary.errors.push(`${m.messageId} (ledger): ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  let n = (await nextRequestNumber()) - 1; // incremented before each use below, unchanged

  for (const m of messages) {
    /** Set by the missed-call explosion below; rides on the report mail's own ledger row. */
    let explodeDetail: string | undefined;
    // QM-D14 consequence 1: a recognised missed-call report ALSO explodes into per-call
    // capture records, replacing the desk's manual half-hourly read of these mails. This runs
    // regardless of what happens to the report mail itself below — the real reports arrive on
    // one rolling thread (775 messages over years), so the report is usually an APPEND, and a
    // re-pulled or already-stored report must still be able to backfill rows. Safe because each
    // row's derived sourceMessageId is keyed on the CALL (phone + instant), not the containing
    // report — the vendor re-lists the same outstanding call in every subsequent report until
    // it's called back, so keying on the report would derive a fresh id, and therefore a fresh
    // duplicate Request, every single cycle (core/missed-calls.ts, found 2026-08-12).
    if (isMissedCallReport(m)) {
      try {
        const { captures, format } = explodeMissedCallReport(m, { aliasToCampus, fallbackCampus });
        // THE CANARY. The previous parser assumed a format the vendor never sent, and its
        // failure was invisible: no rows read, no rows skipped, no error — indistinguishable
        // from a quiet half hour. A report we recognised by sender and subject but cannot READ
        // is now loud, because the desk would otherwise go on believing nobody called.
        if (format === 'unrecognised') {
          summary.errors.push(
            `${m.messageId} (missed-call explosion): report recognised but its table could not be `
            + 'read — the vendor may have changed the layout. No calls were captured from it.',
          );
          explodeDetail = 'Recognised as a missed-call report, but its table could not be read — no calls were captured.';
        } else {
          explodeDetail = `Exploded into ${captures.length} call capture${captures.length === 1 ? '' : 's'}.`;
        }
        // The derived row ids are NOT in the prefetched seen-set above (that query keyed on
        // the FETCHED Message-IDs), so the rows check the store directly.
        const have = captures.length
          ? new Set(
              (await db.request.findMany({
                where: { sourceMessageId: { in: captures.map(c => c.sourceMessageId) } },
                select: { sourceMessageId: true },
              })).map(x => x.sourceMessageId),
            )
          : new Set<string | null>();
        // Blocked callers never become slips (27-Aug-2026). Read ONCE per report rather than
        // per row: a report can list sixty calls, and sixty identical lookups is sixty round
        // trips to learn the same short list.
        const blocked = new Set(
          (await db.blockedCaller.findMany({ select: { phoneKey: true } })).map(b => b.phoneKey),
        );

        for (const c of captures) {
          if (have.has(c.sourceMessageId)) continue; // re-pull: creates nothing
          // Skipped SILENTLY on purpose. A blocked number is a decision already taken; logging
          // it once per call would simply move the noise from the queue into the log.
          if (c.callerPhone && blocked.has(c.callerPhone)) { summary.skipped++; continue; }
          n += 1;
          // BACKLOG's own "link missed-call captures to a Family by caller phone" item: Family
          // linking here mirrors the email path exactly (link-only, never create) — it only
          // ever finds something once a real number is on file via FamilyPhone (the roster
          // import or the QuickLog phone match), so this is inert until then, not new risk.
          const callerPhoneMatch = await db.familyPhone.findFirst({ where: { phoneKey: c.callerPhone }, select: { familyId: true } });
          await db.request.create({
            data: {
              id: randomUUID(), ref: `FD-${String(n).padStart(4, '0')}`,
              channel: c.channel, campusOrgUnitId: c.campusOrgUnitId,
              familyId: callerPhoneMatch?.familyId ?? null,
              subject: c.subject, body: c.body,
              originalRecipients: [],
              arrivedAt: c.arrivedAt, clockStartsAt: c.clockStartsAt, slaDueAt: c.slaDueAt,
              // ackDueAt stays unset: 'unfiled' means a human filing act stamps it (QM-D12).
              category: null, urgency: c.urgency, status: c.status,
              suggestedCategory: c.suggestedCategory,
              suggestedUrgency: c.suggestedUrgency,
              suggestionReason: c.suggestionReason,
              isSwitchboard: c.isSwitchboard,
              // The CALL is a real family contact with a real clock — only the report mail
              // carrying it is machine traffic.
              isAutomated: false,
              sourceMessageId: c.sourceMessageId,
              messages: {
                create: [{
                  id: randomUUID(), direction: 'in', senderLabel: 'Switchboard (missed call)',
                  at: c.arrivedAt, body: c.body,
                }],
              },
              activities: {
                create: [
                  { id: randomUUID(), at: new Date(), kind: 'note',
                    detail: `Captured from the missed-call report ${m.messageId} — nothing auto-enters the working queue; the desk files this like any capture.` },
                  { id: randomUUID(), at: new Date(), kind: 'classified',
                    detail: `Suggested "${c.suggestedCategory}" — ${c.suggestionReason}` },
                ],
              },
            },
          });
          summary.created++; // created can exceed fetched — the explosion is the point
          // Remember it WITHIN this pass, not just from the database.
          //
          // `have` was loaded before the loop, so it could only ever catch rows created by an
          // EARLIER pass. A report that lists the same caller twice at the same second
          // produces the same synthetic id twice -- missedCallRowMessageId is
          // (phone, timestamp) and nothing more -- and the second create hit the unique
          // index. That failure aborted the whole report's explosion, so every remaining call
          // in it was silently dropped until the next pull re-read it.
          //
          // It was happening once an hour on production, logged as
          // 'Unique constraint failed on the fields: (sourceMessageId)' and easy to read as
          // harmless duplicate-suppression rather than what it was.
          have.add(c.sourceMessageId);
        }
      } catch (e) {
        // Same stance as the main loop: one bad report never aborts the run.
        summary.errors.push(`${m.messageId} (missed-call explosion): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const decision = planIngest(m as IngestInput, {
      seenMessageIds: seenIds, threadToRequest, aliasToCampus, fallbackCampus,
      classifierName: process.env.CLASSIFIER ?? 'rules',
    });

    try {
      if (decision.action === 'skip-duplicate') {
        summary.skipped++;
        // Normally a no-op (the row was written when the mail was first processed); it
        // materializes only for pre-ledger mail whose request has since been cleared.
        await ledger(m, 'already_had', messageIdToRequest.get(m.messageId) ?? null, explodeDetail);
        continue;
      }

      if (decision.action === 'append-to-thread') {
        await db.requestMessage.create({
          data: {
            id: randomUUID(), requestId: decision.requestId, direction: 'in',
            senderLabel: m.from.name || m.from.email || 'Unknown sender',
            at: m.sentAt, body: m.body || m.subject,
            attachments: (m.attachments ?? []) as object[],
          },
        });
        await db.activity.create({
          data: {
            id: randomUUID(), requestId: decision.requestId, at: new Date(), kind: 'note',
            detail: `Reply received on the thread. ${decision.reason}`,
          },
        });
        summary.appended++;
        await ledger(m, 'joined_thread', decision.requestId, explodeDetail);
        seenIds.add(m.messageId);
        continue;
      }

      const f = decision.fields;
      n += 1;
      const id = randomUUID();

      // Family linking is LINK-ONLY: an existing Family may be attached by its email key, but
      // one is never created at ingest. core/ingest.ts hands a null key for machine, staff and
      // external senders — and for an ALUMNUS, deliberately (QM-D40): no enrolment, no guardian
      // to notify, no campus by posting, so familyId, grade and section all stay null for them.
      //
      // Checked against BOTH domain aliases (core/senders.ts:emailVariants), not just the literal
      // address this message arrived from: the roster import stores one variant, real mail may
      // arrive on the other, and findUnique on the literal key alone would silently miss half of
      // real traffic for exactly the families this exists to recognise.
      const family = f.familyEmailKey
        ? await db.family.findFirst({ where: { emailKey: { in: emailVariants(f.familyEmailKey) } }, select: { id: true } })
        : null;

      await db.request.create({
        data: {
          id, ref: `FD-${String(n).padStart(4, '0')}`,
          // Channel decides WHEN the acknowledgement clock starts (QM-D12). Email arrives
          // 'unfiled', so planIngest hands ackDueAt null — fileRequest() stamps it at the
          // human filing moment. The app rail (QM-D34(5): submission IS filing, the parent
          // pre-routes via the category menu) creates status 'open' with ackDueAt already
          // computed from the submission instant — filed, but NOT acknowledged.
          channel: f.channel,
          campusOrgUnitId: f.campusOrgUnitId,
          familyId: family?.id ?? null,
          subject: f.subject, body: f.body,
          originalRecipients: f.originalRecipients,
          senderEmail: m.from.email || null,
          arrivedAt: f.arrivedAt, clockStartsAt: f.clockStartsAt, slaDueAt: f.slaDueAt,
          // Stamped only for app-rail items, where submission is filing (QM-D34(5)).
          ackDueAt: f.ackDueAt,
          category: f.category, urgency: f.urgency, status: f.status,
          suggestedCategory: f.suggestedCategory,
          suggestedUrgency: f.suggestedUrgency,
          suggestionReason: f.suggestionReason,
          isVendorNoise: f.isVendorNoise,
          isSafeguarding: f.isSafeguarding,
          isSwitchboard: f.isSwitchboard,
          isAutomated: f.isAutomated,
          senderKind: f.senderKind,
          sourceMessageId: f.sourceMessageId,
          sourceThreadId: f.sourceThreadId,
          messages: {
            create: [{
              id: randomUUID(), direction: 'in',
              senderLabel: m.from.name || m.from.email || 'Unknown sender',
              at: m.sentAt, body: f.body || f.subject,
              // Metadata only — see the schema note. Gmail keeps the bytes.
              attachments: (m.attachments ?? []) as object[],
            }],
          },
          activities: {
            create: [
              { id: randomUUID(), at: new Date(), kind: 'filed', detail: `Ingested from ${source.name}. ${decision.reason}` },
              { id: randomUUID(), at: new Date(), kind: 'classified', detail: `Suggested "${f.suggestedCategory}" — ${f.suggestionReason}` },
            ],
          },
        },
      });
      summary.created++;
      if (f.isAutomated || f.isVendorNoise) summary.parked++;
      await ledger(
        m,
        f.isVendorNoise ? 'parked_vendor' : f.isAutomated ? 'parked_automated' : 'new_request',
        id,
        explodeDetail,
      );
      seenIds.add(m.messageId);
      threadToRequest.set(f.sourceThreadId, id);
    } catch (e) {
      // One bad message must never abort the run — the next one may be a safeguarding case.
      summary.errors.push(`${m.messageId}: ${e instanceof Error ? e.message : String(e)}`);
      await ledger(m, 'error', null, e instanceof Error ? e.message : String(e));
    }
  }

  return summary;
}
