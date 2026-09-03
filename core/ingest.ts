// core/ingest.ts — what to DO with a fetched message. PURE, no I/O.
//
// Three decisions, in order, and each exists because of something in the real archive:
//
//  1. SKIP if the Message-ID is already stored. The same mail reaches six desk members, and
//     polling re-fetches by day granularity — duplicates are the default, not the exception.
//  2. APPEND if the thread is already a request. Real threads run to 775 messages; each reply
//     must not open a new request.
//  3. CREATE otherwise — classified, campus-resolved, and marked automated or not, because 57%
//     of what arrives is the school's own systems and must stay out of the working queue.

import { classifySender, type SenderKind } from './senders';
import { getClassifier, looksLikeSwitchboard } from './classify';
import { machineFamily } from './machine-mail';
import { requestSignal } from './request-signal';
import { addWorkingHours, clockStart, slaDue } from './sla';
import {
  istClockLabel, missedCallRowMessageId, parseMissedCallReport, type MissedCallFormat,
} from './missed-calls';
import { CATEGORY_KEYS, type Urgency } from './taxonomy';

/**
 * The acknowledgement target for the app rail, in working hours. Per QM-D12 acknowledgement
 * "can be near-automatic once filed", so the target is tight — and per QM-D34(5) submission IS
 * filing on this channel, so the clock starts at submission with no human act in between.
 * Seed value; CONFIG per campus and per queue (QM-D12 consequence 5) in the real module.
 */
export const APP_ACK_TARGET_WORKING_HOURS = 1;

export interface IngestInput {
  messageId: string;
  threadId: string;
  from: { name: string; email: string };
  recipients: string[];
  subject: string;
  body: string;
  /**
   * The message's text/html part, when it had one. Needed because some senders put the
   * CONTENT ONLY in the HTML — the Enjay Synapse missed-call reports carry their call table
   * as an HTML <table> whose text/plain alternative is prose (validated 2026-08-08), so
   * `body` cannot see a single row. Classification and display keep reading `body`.
   */
  bodyHtml?: string;
  sentAt: Date;
  deliveredTo?: string;
  /**
   * 'app' when this came through the in-app conversation rail (SD-COM-3) rather than a mailbox.
   * Default 'email'. Only these two arrive via ingestion — calls, walk-ins etc. are logged by a
   * person through QuickLog.
   */
  channel?: 'email' | 'app';
  /**
   * App rail only: the category the parent chose from the deterministic menu (SD-COM-3 —
   * concierge suggest-only, parent confirms). This is ROUTING, not final classification: it
   * pre-files the item, and stays human-editable at triage.
   */
  appCategory?: string;
  /**
   * App rail only: the campus, known from the signed-in student context. The email rail infers
   * campus from addresses (resolveCampus); the app rail never needs to.
   */
  campusOrgUnitId?: string;
}

export interface IngestContext {
  /** Message-IDs already stored. */
  seenMessageIds: ReadonlySet<string>;
  /** Source thread id → existing request id. */
  threadToRequest: ReadonlyMap<string, string>;
  /** Monitored address → campus org-unit id, e.g. "frontdesk@fsksurat.in" → "fsk". */
  aliasToCampus: ReadonlyMap<string, string>;
  /** Used when no monitored alias matches — e.g. mail sent only to a founder. */
  fallbackCampus: string;
  classifierName?: string;
}

export interface IngestFields {
  channel: 'email' | 'app';
  subject: string;
  body: string;
  campusOrgUnitId: string;
  arrivedAt: Date;
  clockStartsAt: Date;
  slaDueAt: Date | null;
  /**
   * The acknowledgement clock (QM-D12). Stamped at CREATE only on the app rail, where
   * submission is filing (QM-D34(5)). Email stays null here — it needs a human filing act
   * because nobody routed it, and the clock fires on filing, not capture.
   */
  ackDueAt: Date | null;
  originalRecipients: string[];
  sourceMessageId: string;
  sourceThreadId: string;
  senderKind: SenderKind;
  /**
   * Link (never create) a Family record by this key, when one exists. null for machine, staff
   * and external senders — and for an ALUMNUS, deliberately (QM-D40): an alumnus has no
   * enrolment, no guardian to notify and no campus by posting, so synthesising a Family for
   * them would fabricate all three. Their familyId, grade and section stay null.
   */
  familyEmailKey: string | null;
  isAutomated: boolean;
  isSwitchboard: boolean;
  isVendorNoise: boolean;
  isSafeguarding: boolean;
  suggestedCategory: string;
  suggestedUrgency: Urgency;
  suggestionReason: string;
  /** Only pre-set when a human would obviously agree; otherwise left for triage. */
  category: string | null;
  status: 'unfiled' | 'not_a_request' | 'open';
  urgency: Urgency;
}

export type IngestDecision =
  | { action: 'skip-duplicate'; reason: string }
  | { action: 'append-to-thread'; requestId: string; reason: string }
  | { action: 'create'; fields: IngestFields; reason: string };

/** Which campus a message belongs to, from the address it was actually delivered to. */
export function resolveCampus(
  msg: Pick<IngestInput, 'deliveredTo' | 'recipients'>,
  aliasToCampus: ReadonlyMap<string, string>,
  fallback: string,
): { campus: string; how: string } {
  const norm = (s: string) => s.trim().toLowerCase();
  if (msg.deliveredTo) {
    const hit = aliasToCampus.get(norm(msg.deliveredTo));
    if (hit) return { campus: hit, how: `Delivered-To ${norm(msg.deliveredTo)}` };
  }
  for (const r of msg.recipients) {
    const hit = aliasToCampus.get(norm(r));
    if (hit) return { campus: hit, how: `addressed to ${norm(r)}` };
  }
  // 44% of real parent mail goes to a founder rather than a desk address, so this path is
  // ordinary, not exceptional.
  return { campus: fallback, how: 'no monitored desk address matched' };
}

/**
 * Link (never create) a Family. Only a parent or enrolled-student account may carry a key; an
 * alumnus explicitly may NOT (QM-D40) — no enrolment, no guardian to notify, no campus by
 * posting, so a synthetic family would fabricate all three.
 */
const familyKeyFor = (kind: SenderKind, email: string): string | null =>
  kind === 'parent' || kind === 'student' ? email.trim().toLowerCase() : null;

export function planIngest(msg: IngestInput, ctx: IngestContext): IngestDecision {
  if (ctx.seenMessageIds.has(msg.messageId)) {
    return { action: 'skip-duplicate', reason: `Message-ID ${msg.messageId} is already stored.` };
  }

  const existing = ctx.threadToRequest.get(msg.threadId);
  if (existing) {
    return {
      action: 'append-to-thread',
      requestId: existing,
      reason: `Continues thread ${msg.threadId}, already tracked as a request.`,
    };
  }

  const sender = classifySender({
    name: msg.from.name, email: msg.from.email, subject: msg.subject, body: msg.body,
  });

  // Automated by the SENDER, or by the shape of the subject.
  //
  // The sender test alone was missing the biggest family of notification the desk receives:
  // exit passes and sickbay notices arrive from a Google Form on a person's address, so
  // classifySender reads them as a human writing in and they landed in the working queue. 100
  // of the 280 live emails since 01-Aug were exactly that.
  //
  // VK, 27-Aug-2026, asked directly whether they belong in the queue: "no they should not...
  // front desk can refer to the app if at all they need to refer to this information". That
  // overrides the earlier reading in core/machine-mail.ts, which kept exit passes in the queue
  // on the grounds that somebody has to release the child. They do -- but from the corridor and
  // the form, not from this inbox. The email is a RECORD, and a record does not need a queue.
  const machine = machineFamily(msg.subject);
  const isAutomated = sender.kind === 'machine' || Boolean(machine);
  const knownFamily = sender.kind === 'parent' || sender.kind === 'student';

  const sug = getClassifier(ctx.classifierName ?? 'rules').classify({
    subject: msg.subject, body: msg.body,
    // The app rail only exists behind a signed-in family account (QM-D38), so it is always a
    // known sender — the vendor-noise filter has no business there.
    senderIsKnownFamily: knownFamily || msg.channel === 'app',
    senderKind: sender.kind,
  });
  const sb = looksLikeSwitchboard(`${msg.subject} ${msg.body}`);

  if (msg.channel === 'app') {
    // The app rail (QM-D34, 2026-08-07). SD-COM-3 had the parent choose the category from a
    // deterministic menu — the concierge is suggest-only and the parent confirms, so the human
    // act that filing exists to provide has ALREADY happened. Per QM-D34(5) submission IS
    // filing: the item lands 'open' with no unfiled stop, and the acknowledgement clock is
    // stamped from the submission instant. The classifier still runs — safeguarding is
    // content-based, never flag-based (R3-18), so a safety case filed under "transport" by the
    // parent must still surface — but its output stays a suggestion beside the parent's pick.
    const validPick = msg.appCategory != null && CATEGORY_KEYS.includes(msg.appCategory);
    // A pick outside the menu (a stale client, a menu drift) falls to 'unclassified' so it
    // LOOKS untriaged and a person reads it — never silently adopted, never guessed.
    const category = validPick ? msg.appCategory! : 'unclassified';

    // Campus comes from the signed-in student context, not address inference. An id we do not
    // recognise falls back rather than trusting the client's string (scope is checked on
    // writes — R3-14 thinking applies to machine writers too).
    const knownCampuses = new Set(ctx.aliasToCampus.values());
    const campusOk = msg.campusOrgUnitId != null
      && (knownCampuses.has(msg.campusOrgUnitId) || msg.campusOrgUnitId === ctx.fallbackCampus);

    return {
      action: 'create',
      reason: `New app submission from a ${sender.kind} account, pre-routed to "${category}" by `
        + 'the sender\'s own menu pick — submission is filing on this rail (QM-D34(5)).',
      fields: {
        channel: 'app',
        subject: msg.subject,
        body: msg.body,
        campusOrgUnitId: campusOk ? msg.campusOrgUnitId! : ctx.fallbackCampus,
        arrivedAt: msg.sentAt,
        clockStartsAt: clockStart(msg.sentAt),
        slaDueAt: slaDue(msg.sentAt, sug.urgency),
        ackDueAt: addWorkingHours(msg.sentAt, APP_ACK_TARGET_WORKING_HOURS),
        originalRecipients: msg.recipients,
        sourceMessageId: msg.messageId,
        sourceThreadId: msg.threadId,
        senderKind: sender.kind,
        familyEmailKey: familyKeyFor(sender.kind, msg.from.email),
        isAutomated: false,
        isSwitchboard: sb.yes,
        isVendorNoise: false,
        isSafeguarding: sug.isSafeguarding,
        suggestedCategory: sug.category,
        suggestedUrgency: sug.urgency,
        suggestionReason: sug.reason,
        category,
        status: 'open',
        urgency: sug.urgency,
      },
    };
  }

  const { campus, how } = resolveCampus(msg, ctx.aliasToCampus, ctx.fallbackCampus);

  // Automated notifications and vendor blasts are recorded but never enter the working queue,
  // and they get no response clock — nobody owes a robot a reply inside four hours.
  //
  // Register #5, resolved by VK on 27-Aug-2026: internal staff mail skips the queue "only when
  // it carries no request; front desk decides." Both halves are built here:
  //
  //   ONLY WHEN IT CARRIES NO REQUEST — not "whenever a colleague sent it". A colleague
  //   forwarding a parent's complaint and a colleague forwarding a notification arrive from the
  //   same address looking identical, so the test is on the WORDS. core/request-signal.ts is
  //   deliberately built to assume a request unless there is positive evidence otherwise.
  //
  //   FRONT DESK DECIDES — the reason is written onto the record in plain language, and
  //   bringIntoQueue() puts it back in one click. Set aside by the app, overruled by a person;
  //   never the other way round (AI-13).
  const internal = sender.kind === 'staff' ? requestSignal(msg.subject, msg.body) : null;
  const internalNoAsk = internal !== null && !internal.carriesRequest;

  const parked = isAutomated || sug.isVendorNoise || internalNoAsk;

  return {
    action: 'create',
    reason: `New ${sender.kind} message; campus from ${how}.`
      + (internalNoAsk ? ` Internal mail that asks for nothing — ${internal!.reason}` : '')
      + (parked ? ' Parked out of the working queue.' : ''),
    fields: {
      channel: 'email',
      subject: msg.subject,
      body: msg.body,
      campusOrgUnitId: campus,
      arrivedAt: msg.sentAt,
      clockStartsAt: clockStart(msg.sentAt),
      slaDueAt: parked ? null : slaDue(msg.sentAt, sug.urgency),
      // The email rail's acknowledgement clock starts at FILING (QM-D12) — a human act that has
      // not happened yet at ingest, so nothing is stamped here.
      ackDueAt: null,
      originalRecipients: msg.recipients,
      sourceMessageId: msg.messageId,
      sourceThreadId: msg.threadId,
      senderKind: sender.kind,
      familyEmailKey: familyKeyFor(sender.kind, msg.from.email),
      isAutomated,
      isSwitchboard: sb.yes,
      isVendorNoise: sug.isVendorNoise,
      isSafeguarding: sug.isSafeguarding,
      suggestedCategory: sug.category,
      suggestedUrgency: sug.urgency,
      suggestionReason: sug.reason,
      // A parked machine notice KEEPS its real category rather than being flattened to
      // 'not-a-request'. It is out of the working queue either way, and "this is a sickbay
      // notice" is precisely the information VK wants findable when the desk goes looking --
      // /mailbox lists every parked mail, and a meaningless label there would defeat the point.
      category: machine ? machine.category : parked ? 'not-a-request' : null,
      status: parked ? 'not_a_request' : 'unfiled',
      urgency: sug.urgency,
    },
  };
}

// ---------------------------------------------------------------------------------------
// The missed-call explosion (QM-D14 consequence 1): a recognised Enjay Synapse missed-call
// report ALSO becomes per-call capture records, replacing the desk's manual half-hourly read
// of these mails. The report mail itself is untouched by this — it stays a parked machine
// mail exactly as planIngest above decides (usually an append onto the years-long rolling
// thread). Recognition lives in core/missed-calls.ts (isMissedCallReport).
// ---------------------------------------------------------------------------------------

/**
 * A per-call capture record. Deliberately NOT IngestFields: a missed call is not mail — it
 * has no sender identity, no recipients, no thread — and forcing it through the mail shape
 * would mean inventing values for all three. What it shares with every other capture is the
 * lifecycle: 'unfiled', a running response clock, and a human filing act ahead of it.
 */
export interface MissedCallCapture {
  channel: 'call';
  subject: string;
  body: string;
  campusOrgUnitId: string;
  /** The call instant, not the report instant — the family's wait started when they rang. */
  arrivedAt: Date;
  clockStartsAt: Date;
  /**
   * The response clock runs from the call, exactly as an unfiled email's runs from arrival:
   * slow triage must not hide how long a caller has been waiting for the callback.
   */
  slaDueAt: Date;
  /** The call's own phone + instant (core/missed-calls.ts) — stable across every report cycle
   *  that re-lists it while outstanding, not just a re-pull of the same report. */
  sourceMessageId: string;
  /** Normalised last-10-digits, for a Family-by-phone lookup at the write site (core/ stays pure). */
  callerPhone: string;
  /** A missed board-line call is switchboard traffic by nature (the 48% finding). */
  isSwitchboard: true;
  /**
   * NOTHING auto-enters the working queue (cardinal finding: ~1 in 5 of public inbound is a
   * real request) — the desk files each of these exactly as it triages every capture. The
   * acknowledgement clock is deliberately absent here: it fires on filing (QM-D12).
   */
  status: 'unfiled';
  urgency: Urgency;
  suggestedCategory: string;
  suggestedUrgency: Urgency;
  suggestionReason: string;
}

/**
 * Explode a missed-call report into capture records. PURE — the caller dedups on each row's
 * derived sourceMessageId (deterministic per report body) and writes.
 *
 * The board-line code maps to a campus only when it names one we know; anything else falls
 * back rather than trusting the report's string — the same stance the app rail takes on a
 * client-supplied campus id. CONFIG (line code → campus) in the real module.
 */
export function explodeMissedCallReport(
  msg: Pick<IngestInput, 'messageId' | 'subject' | 'body' | 'bodyHtml' | 'sentAt'>,
  ctx: Pick<IngestContext, 'aliasToCampus' | 'fallbackCampus'>,
): {
  captures: MissedCallCapture[];
  skippedLines: number;
  /** 'unrecognised' means the report could not be READ — not that it held no calls. */
  format: MissedCallFormat;
  /** Rows the vendor's own record already shows as returned; deliberately not made into work. */
  alreadyCalledBack: number;
} {
  // The table lives in the HTML part; `body` is prose. A body that IS html still works, which
  // keeps the seed/demo sources and any plain-text sender honest.
  const { entries, skipped, format } = parseMissedCallReport(msg.bodyHtml || msg.body);
  const knownCampuses = new Set(ctx.aliasToCampus.values());
  const reportLabel = istClockLabel(msg.sentAt);

  // A call the switchboard already rang back is not work the desk owes anyone — the vendor
  // records that itself (`Callback Status`), and only 9.5% of real rows carry it. Filing the
  // other 90.5% is the point of this feature; filing all of them would hand the desk work it
  // has already done. Counted, never silently dropped.
  const outstanding = entries.filter(e => !e.callbackDone);

  const captures = outstanding.map((e): MissedCallCapture => {
    const arrivedAt = e.at;
    const atIst = istClockLabel(e.at);
    const campus =
      e.destination && knownCampuses.has(e.destination) ? e.destination : ctx.fallbackCampus;
    return {
      channel: 'call',
      subject: `Missed call at ${atIst} — ${e.callerPhone}`,
      body:
        `The board line rang unanswered at ${atIst} IST (caller ${e.callerPhone}). ` +
        `Call back, then file what it was actually about.`,
      campusOrgUnitId: campus,
      arrivedAt,
      clockStartsAt: clockStart(arrivedAt),
      slaDueAt: slaDue(arrivedAt, 'normal'),
      sourceMessageId: missedCallRowMessageId(e.callerPhone, e.at),
      callerPhone: e.callerPhone,
      isSwitchboard: true,
      status: 'unfiled',
      urgency: 'normal',
      // 'unclassified' is the honest suggestion: nobody knows what the call was about until
      // someone rings back — a confident guess here would file blind.
      suggestedCategory: 'unclassified',
      suggestedUrgency: 'normal',
      suggestionReason:
        `Row ${e.row} of the ${reportLabel} missed-call report — the switchboard line went ` +
        `unanswered, so the desk owes this caller a ring back before anyone knows what it was about.`,
    };
  });

  return {
    captures,
    skippedLines: skipped,
    format,
    alreadyCalledBack: entries.length - outstanding.length,
  };
}
