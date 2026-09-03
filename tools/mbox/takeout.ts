// tools/mbox/takeout.ts — the Takeout intake kit: the whole archive, one command.
//
//   npm run takeout -- <export.mbox | takeout-dir> [--out <report.md>] [--limit N]
//
// The Google Takeout export this exists for is ~109k messages of CHILDREN'S DATA, and it
// lives OUTSIDE this repo — the repo-root .gitignore refuses takeout/, *.mbox and analysis/
// precisely so a catch-all `git add -A` can never pick it up. This runner is the one
// sanctioned way to touch that archive, and its only artefact is a fully-REDACTED aggregate
// report. The discipline, stated once and enforced below:
//
//   report  = counts, distributions, local-part SHAPES and redacted subjects — shareable.
//   archive = never enters the repo, never gets quoted; a body goes no further than the
//             two classifiers and is dropped with the message.
//
// Every line of the report passes residualPii() BEFORE anything touches disk; one hit aborts
// the whole run and nothing is written — a report that is 99% safe is not a report that can
// be pasted anywhere. Streaming via readMbox, O(1) memory beyond the aggregate counters, so
// the full export runs in one pass on this laptop.
//
// This is a RUNNER over parts proven elsewhere (core/rfc822, core/senders, core/classify,
// tools/mbox/redact) — it re-implements none of them. analyse.ts remains the deeper
// per-group instrument (threading via References, coordination, responsiveness); this one
// trades that depth for the ability to hold 109k messages in constant memory.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { readMbox, parseAddresses, type RawMessage } from './parse';
import {
  classifySender, isSchoolDomain, isParentAddress, isStudentAddress, isAlumnusAddress,
  type SenderKind,
} from '../../core/senders';
import { redact, redactSubject, residualPii } from './redact';
import { getClassifier } from '../../core/classify';
import { categoryDef } from '../../core/taxonomy';

const classifier = getClassifier('rules');

/** The desk lives in IST. Fixed +05:30 — India has no DST, so a constant is correct. */
const IST_MINUTES = 330;
const ist = (d: Date) => new Date(+d + IST_MINUTES * 60_000);

/** At most this many unknown local-part shapes ever reach the report. */
const SHAPE_CAP = 20;

/** A subject family needs this many messages to be a stream rather than a coincidence. */
const STREAM_MIN = 25;
/** At most this many stream rows reach the report. */
const STREAM_ROWS = 25;

// A school-domain local-part matching no convention is usually a person's name. The SHAPE —
// letters flattened to 'x', digits to 'n', separators kept — is the only safe thing to print:
// "xxxxx.xxxxxx" tells you whether the estate uses first.last without telling you who, and
// "xnnnn.xxx" still reads as alumnus-like without carrying the year. Digits are flattened
// DELIBERATELY: an earlier version kept them "because the residualPii gate would catch a
// phone", and verification proved that claim false twice — a student id's numeric tail
// ('fsk2099001' → 'xxx2099001') survives because flattening the letters destroys the FSK
// prefix the gate's regex needs, and a 12-digit run passes because the phone pattern's \b
// cannot match inside it. Digits ARE the identifier; the shape carries none.
const localShape = (local: string) => local.replace(/\p{L}/gu, 'x').replace(/\d/g, 'n');

// A List-ID header is `Description <list.domain.tld>`, or occasionally the bare id. The local
// part is a role or team name and is treated as identifying (a personal list carries a name),
// so only the DOMAIN and a desk-or-not flag ever leave this function.
export function parseListId(v: string): { id: string; domain: string } | null {
  const bracketed = v.match(/<([^>]+)>/);
  const id = (bracketed ? bracketed[1] : v).trim().toLowerCase();
  if (!id || /\s/.test(id)) return null;
  const dot = id.indexOf('.');
  return dot < 0 ? null : { id, domain: id.slice(dot + 1) };
}

/** Whether a list is a front-desk list. Matches the `--match` handle, not a specific campus. */
const DESK_LIST = /^front[\s._-]?desk\./;

type Conv = 'p' | 's' | 'alum' | 'other';
const convention = (email: string): Conv =>
  isParentAddress(email) ? 'p'
  : isStudentAddress(email) ? 's'
  : isAlumnusAddress(email) ? 'alum'
  : 'other';

// Threading here is keyed on the normalised subject ONLY — an approximation, and a known one:
// an mbox export carries no Gmail threadId, and unlike analyse.ts there is no
// References/In-Reply-To union-find (that needs every message id in memory; this runner is
// O(1) by design). Same-subject messages from DIFFERENT senders merge, so thread counts read
// slightly low and depths slightly deep. Aggregate-grade only — never read coordination out
// of this: subject-merging is exactly what destroys that signal (see analyse.ts).
const normSubj = (s: string) =>
  s.replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '').replace(/^\s*subject\s*:\s*/i, '')
   .toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * A subject family: the redacted subject with Re:/Fwd: stripped and every digit run
 * flattened to «n». Flattening is what makes this useful — "ID card verification details
 * 2021-22" through "…2026-27" are ONE annual campaign, and six rows in the top-subjects
 * table hide that. Returns '' for a subject that survives to nothing.
 */
export function subjectTemplate(subject: string): string {
  return redactSubject(subject)
    .replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '')
    .replace(/\d+/g, '«n»')
    .replace(/(\s*«n»\s*[-–/]\s*)+«n»/g, ' «n»')   // "«n»-«n»" academic years read as one
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const isReply = (subject: string) => /^\s*(re|fwd|fw)\s*:/i.test(subject);

// ---------------------------------------------------------------------------- aggregates
interface ConvAgg { messages: number; senders: Set<string> }

interface StreamAgg {
  /** First-seen casing, for display. The map key is the lower-cased template. */
  label: string;
  messages: number;
  machine: number;
  replies: number;
  firstYear: number | null;
  lastYear: number | null;
}

interface Agg {
  messages: number;
  undated: number;
  first: number | null;
  last: number | null;
  perYear: Map<number, number>;
  kinds: Map<SenderKind, number>;
  nonMachine: number;
  vendorNoise: number;
  safeguarding: number;
  categories: Map<string, number>;
  urgencies: Map<string, number>;
  confidences: Map<string, number>;
  conv: Record<Conv, ConvAgg>;
  convByDomain: Map<string, Record<Conv, number>>;
  otherShapes: Set<string>;
  hourAll: number[];
  hourFamily: number[];
  threads: Map<string, number>;
  noSubject: number;
  subjects: Map<string, number>;
  /** Keyed on the full List-ID, which is NEVER printed — only its domain and desk-ness are. */
  lists: Map<string, { domain: string; desk: boolean; messages: number }>;
  /** Subject families, keyed on the lower-cased template. */
  streams: Map<string, StreamAgg>;
}

const newAgg = (): Agg => ({
  messages: 0, undated: 0, first: null, last: null,
  perYear: new Map(), kinds: new Map(),
  nonMachine: 0, vendorNoise: 0, safeguarding: 0,
  categories: new Map(), urgencies: new Map(), confidences: new Map(),
  conv: {
    p: { messages: 0, senders: new Set() },
    s: { messages: 0, senders: new Set() },
    alum: { messages: 0, senders: new Set() },
    other: { messages: 0, senders: new Set() },
  },
  convByDomain: new Map(),
  otherShapes: new Set(),
  hourAll: Array.from({ length: 24 }, () => 0),
  hourFamily: Array.from({ length: 24 }, () => 0),
  threads: new Map(), noSubject: 0,
  subjects: new Map(),
  lists: new Map(),
  streams: new Map(),
});

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/** Every List-ID / Mailing-list value on a message (repeated headers included). */
const h2list = (raw: RawMessage): string[] =>
  [...(raw.headersAll['list-id'] ?? []), ...(raw.headersAll['mailing-list'] ?? [])];

function ingest(agg: Agg, raw: RawMessage): void {
  const h = raw.headers;
  const from = parseAddresses(h['from'])[0] ?? { name: '', email: '' };
  const subject = (h['subject'] || '').trim();
  const parsed = h['date'] ? new Date(h['date']) : null;
  const date = parsed && !isNaN(+parsed) ? parsed : null;
  // Enough body for the machine-body patterns (they scan the first 2000 chars) and the rules
  // classifier. The body goes NO further than these two calls — it is never stored, never
  // written, and leaves scope with this function.
  const sample = raw.text.slice(0, 2000);

  agg.messages++;
  if (date) {
    const t = +date;
    if (agg.first == null || t < agg.first) agg.first = t;
    if (agg.last == null || t > agg.last) agg.last = t;
    const l = ist(date);
    bump(agg.perYear, l.getUTCFullYear());
    agg.hourAll[l.getUTCHours()]++;
  } else {
    agg.undated++;
  }

  const v = classifySender({ name: from.name, email: from.email, subject, body: sample });
  bump(agg.kinds, v.kind);

  const family = v.kind === 'parent' || v.kind === 'student';
  if (family && date) agg.hourFamily[ist(date).getUTCHours()]++;

  if (v.kind !== 'machine') {
    // Per MESSAGE, not per thread-opener as analyse.ts does — a streaming pass has no
    // threads to open. Distributions shift toward reply-heavy categories accordingly;
    // acceptable for a full-archive aggregate, and stated in the report.
    const sug = classifier.classify({
      subject, body: sample, senderIsKnownFamily: family, senderKind: v.kind,
    });
    agg.nonMachine++;
    if (sug.isVendorNoise) agg.vendorNoise++;
    // COUNT only. The substance of a safeguarding message stays in the archive — the report
    // must be safe to paste anywhere, and a safeguarding excerpt never is.
    if (sug.isSafeguarding) agg.safeguarding++;
    bump(agg.categories, sug.category);
    bump(agg.urgencies, sug.urgency);
    bump(agg.confidences, sug.confidence);
  }

  // QM-D40's account conventions (p. / s. / a<year>.), tested empirically against the real
  // estate — every school-domain sender either matches one or lands in `other` as a shape.
  if (from.email && isSchoolDomain(from.email)) {
    const local = from.email.split('@')[0] ?? '';
    const domain = from.email.split('@')[1] ?? '';
    const conv = convention(from.email);
    agg.conv[conv].messages++;
    agg.conv[conv].senders.add(from.email);
    const d = agg.convByDomain.get(domain) ?? { p: 0, s: 0, alum: 0, other: 0 };
    d[conv]++;
    agg.convByDomain.set(domain, d);
    if (conv === 'other' && agg.otherShapes.size < SHAPE_CAP) {
      agg.otherShapes.add(localShape(local));
    }
  }

  // Which list delivered it. A member-mailbox export mixes several groups' traffic, so this
  // is how a reader knows WHOSE desk mail the report describes — the 2026-08-08 archive spans
  // three campus desks in wildly different volumes.
  for (const value of h2list(raw)) {
    const lid = parseListId(value);
    if (!lid) continue;
    const cur = agg.lists.get(lid.id)
      ?? { domain: lid.domain, desk: DESK_LIST.test(lid.id), messages: 0 };
    cur.messages++;
    agg.lists.set(lid.id, cur);
  }

  const k = normSubj(subject);
  if (k) bump(agg.threads, k); else agg.noSubject++;

  const rs = redactSubject(subject);
  if (rs) bump(agg.subjects, rs);

  // The FYI question, measured: which subject families are almost entirely machine-sent?
  // Those are the ones the desk should be able to LOOK UP rather than read (VK, 2026-08-08).
  // Replies are counted separately because a family can be FYI in aggregate and still draw
  // parent questions — that family needs a human path back in, not just an archive.
  //
  // TWO RULES FOR WHOEVER BUILDS THE FYI STREAM, both measured over the 2026-08-08 archive:
  //
  // 1. Key the stream on SUBJECT-FAMILY RECURRENCE, never on `v.kind === 'machine'`. The
  //    largest family in five years of desk mail (9,489 messages, an annual ID-card
  //    verification campaign) is 0% machine, because a person sends it from a staff address
  //    with a mail merge. Two more of the top five are 0% for the same reason. A sender-kind
  //    gate would let the single biggest notification stream flood the working queue —
  //    which is precisely the outcome the stream exists to prevent.
  // 2. The notification is FYI; the REPLY to it is a request. Families split cleanly:
  //    near-zero-reply (exit passes 5/1,606, sickbay 4/591, reject forms 15/3,121) versus
  //    reply-heavy (early leave 306/398, new admissions 500/740, personal-details updates
  //    1,722/3,602). Filtering a reply-heavy family wholesale silently drops real requests.
  const tpl = subjectTemplate(subject);
  if (tpl) {
    const key = tpl.toLowerCase();
    const s = agg.streams.get(key)
      ?? { label: tpl, messages: 0, machine: 0, replies: 0, firstYear: null, lastYear: null };
    s.messages++;
    if (v.kind === 'machine') s.machine++;
    if (isReply(subject)) s.replies++;
    if (date) {
      const y = ist(date).getUTCFullYear();
      if (s.firstYear == null || y < s.firstYear) s.firstYear = y;
      if (s.lastYear == null || y > s.lastYear) s.lastYear = y;
    }
    agg.streams.set(key, s);
  }
}

// ---------------------------------------------------------------------------- summary
export interface ConvStat { messages: number; senders: number }

export interface TakeoutReport {
  messages: number;
  undated: number;
  firstDate: string | null;
  lastDate: string | null;
  perYear: Array<{ year: number; messages: number }>;
  senderKinds: Array<{ kind: SenderKind; messages: number; pct: number }>;
  machineSharePct: number;
  nonMachine: number;
  vendorNoise: number;
  vendorNoisePct: number;
  safeguardingHits: number;
  categories: Array<{ key: string; messages: number }>;
  urgencies: Array<{ key: string; messages: number }>;
  confidences: Array<{ key: string; messages: number }>;
  conventions: {
    p: ConvStat; s: ConvStat; alum: ConvStat; other: ConvStat;
    byDomain: Array<{ domain: string; p: number; s: number; alum: number; other: number }>;
    otherShapes: string[];
  };
  hourOfDayIst: number[];
  hourOfDayIstFamily: number[];
  share0609AllPct: number;
  share0609FamilyPct: number;
  threads: { count: number; maxDepth: number; depth: Array<{ bucket: string; threads: number }> };
  topSubjects: Array<{ subject: string; messages: number }>;
  /** Which lists delivered the mail, by domain — the local part is never carried. */
  deliveryLists: Array<{ domain: string; deskList: boolean; lists: number; messages: number }>;
  /** Subject families big enough to be worth a decision, most-frequent first. */
  streams: Array<{
    family: string; messages: number; machinePct: number; replies: number;
    firstYear: number | null; lastYear: number | null;
  }>;
  sourceFiles: string[];
  limited: boolean;
  /** Present only when --match was given: what ran and how much it kept. */
  filter?: { pattern: string; scanned: number; kept: number };
  /** Present only when --dedupe was given: repeats of an already-counted Message-ID. */
  dedupe?: { duplicatesDropped: number; withoutMessageId: number };
  generatedAt: string;
}

const pct = (n: number, d: number) => (d ? +(100 * n / d).toFixed(1) : 0);
const sortDesc = <K>(m: Map<K, number>) => [...m].sort((a, b) => b[1] - a[1]);

const depthBucket = (n: number) => (n >= 20 ? '20+' : n >= 6 ? '6–19' : n >= 3 ? '3–5' : String(n));
const DEPTH_ORDER = ['1', '2', '3–5', '6–19', '20+'];

function summarise(
  agg: Agg,
  meta: {
    sourceFiles: string[]; limited: boolean;
    filter?: TakeoutReport['filter']; dedupe?: TakeoutReport['dedupe'];
  },
): TakeoutReport {
  const datedAll = agg.hourAll.reduce((a, b) => a + b, 0);
  const datedFamily = agg.hourFamily.reduce((a, b) => a + b, 0);
  const band0609 = (h: number[]) => h[6] + h[7] + h[8];

  const depthCount = new Map<string, number>();
  let threadCount = agg.noSubject;         // an empty subject cannot merge; each is its own thread
  let maxDepth = agg.noSubject ? 1 : 0;
  if (agg.noSubject) depthCount.set('1', agg.noSubject);
  for (const n of agg.threads.values()) {
    threadCount++;
    if (n > maxDepth) maxDepth = n;
    bump(depthCount, depthBucket(n));
  }

  const machine = agg.kinds.get('machine') ?? 0;
  const stat = (c: ConvAgg): ConvStat => ({ messages: c.messages, senders: c.senders.size });

  return {
    messages: agg.messages,
    undated: agg.undated,
    // Shifted to IST before slicing the calendar date, so the span edges agree with the
    // per-year table and the hour histogram (a 00:40 IST Jan-1 message is that year's, not
    // the prior year's UTC date).
    firstDate: agg.first != null ? ist(new Date(agg.first)).toISOString().slice(0, 10) : null,
    lastDate: agg.last != null ? ist(new Date(agg.last)).toISOString().slice(0, 10) : null,
    perYear: [...agg.perYear].sort((a, b) => a[0] - b[0]).map(([year, messages]) => ({ year, messages })),
    senderKinds: sortDesc(agg.kinds).map(([kind, messages]) => ({ kind, messages, pct: pct(messages, agg.messages) })),
    machineSharePct: pct(machine, agg.messages),
    nonMachine: agg.nonMachine,
    vendorNoise: agg.vendorNoise,
    vendorNoisePct: pct(agg.vendorNoise, agg.nonMachine),
    safeguardingHits: agg.safeguarding,
    categories: sortDesc(agg.categories).map(([key, messages]) => ({ key, messages })),
    urgencies: sortDesc(agg.urgencies).map(([key, messages]) => ({ key, messages })),
    confidences: sortDesc(agg.confidences).map(([key, messages]) => ({ key, messages })),
    conventions: {
      p: stat(agg.conv.p), s: stat(agg.conv.s), alum: stat(agg.conv.alum), other: stat(agg.conv.other),
      byDomain: [...agg.convByDomain]
        .map(([domain, c]) => ({ domain, ...c }))
        .sort((a, b) => (b.p + b.s + b.alum + b.other) - (a.p + a.s + a.alum + a.other)),
      otherShapes: [...agg.otherShapes].sort(),
    },
    hourOfDayIst: agg.hourAll,
    hourOfDayIstFamily: agg.hourFamily,
    share0609AllPct: pct(band0609(agg.hourAll), datedAll),
    share0609FamilyPct: pct(band0609(agg.hourFamily), datedFamily),
    threads: {
      count: threadCount,
      maxDepth,
      depth: DEPTH_ORDER.filter(b => depthCount.has(b)).map(b => ({ bucket: b, threads: depthCount.get(b)! })),
    },
    topSubjects: sortDesc(agg.subjects).slice(0, 15).map(([subject, messages]) => ({ subject, messages })),
    deliveryLists: [...groupLists(agg.lists).values()]
      .sort((a, b) => b.messages - a.messages).slice(0, 12),
    streams: [...agg.streams.values()]
      .filter(s => s.messages >= STREAM_MIN)
      .sort((a, b) => b.messages - a.messages)
      .slice(0, STREAM_ROWS)
      .map(s => ({
        family: s.label, messages: s.messages, machinePct: pct(s.machine, s.messages),
        replies: s.replies, firstYear: s.firstYear, lastYear: s.lastYear,
      })),
    sourceFiles: meta.sourceFiles,
    limited: meta.limited,
    filter: meta.filter,
    dedupe: meta.dedupe,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };
}

/** Collapse per-list counts into (domain, desk-or-not) rows; the list id itself stays here. */
function groupLists(lists: Agg['lists']) {
  const rows = new Map<string, TakeoutReport['deliveryLists'][number]>();
  for (const l of lists.values()) {
    const key = `${l.domain}|${l.desk}`;
    const cur = rows.get(key) ?? { domain: l.domain, deskList: l.desk, lists: 0, messages: 0 };
    cur.lists++;
    cur.messages += l.messages;
    rows.set(key, cur);
  }
  return rows;
}

// ---------------------------------------------------------------------------- report
function renderMarkdown(r: TakeoutReport): string[] {
  const row = (a: unknown[]) => `| ${a.join(' | ')} |`;
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const L: string[] = [];

  L.push('# Takeout archive — aggregate intake report', '');
  const files = r.sourceFiles.length > 8
    ? `${r.sourceFiles.slice(0, 8).join(', ')} … (+${r.sourceFiles.length - 8} more)`
    : r.sourceFiles.join(', ');
  L.push(`Source: ${r.sourceFiles.length} mbox file(s) — ${files}. Generated ${r.generatedAt}.`);
  if (r.filter) {
    // The pattern goes through redact() like every other foreign string — and the gate
    // still checks the rendered line, so an address-bearing pattern aborts rather than ships.
    L.push('', `Filter: list/recipient headers matching \`/${redact(r.filter.pattern)}/i\` — `
      + `kept ${r.filter.kept} of ${r.filter.scanned} messages scanned.`);
  }
  if (r.dedupe) {
    L.push('', `Deduplicated by Message-ID: ${r.dedupe.duplicatesDropped} repeat(s) dropped — `
      + 'several mailboxes in this export belong to members of the same groups, so the same '
      + `message arrives more than once. ${r.dedupe.withoutMessageId} message(s) carried no `
      + 'Message-ID and were kept unconditionally.');
  }
  if (r.limited) {
    // With a filter active, what the limit stopped was the SCAN, not the kept count.
    L.push('', `**Limited run** — stopped after the first ${r.filter?.scanned ?? r.messages} messages. A smoke sample, not the archive.`);
  }
  L.push('');
  L.push('> Redacted output. Counts, distributions, local-part shapes and redacted subjects only —');
  L.push('> no message bodies, no names, no addresses, no phone numbers, no student IDs. Every');
  L.push('> line passed a residual-PII gate before writing. The archive itself never enters the repo.');
  L.push('');

  L.push('## Totals', '');
  L.push(row(['Metric', 'Value']), row(['---', '---']));
  L.push(row(['Messages', r.messages]));
  L.push(row(['Date span', r.firstDate && r.lastDate ? `${r.firstDate} → ${r.lastDate}` : 'n/a']));
  L.push(row(['Without a usable Date header', r.undated]));
  L.push('');
  L.push('### Per year (IST)', '');
  L.push(row(['Year', 'Messages']), row(['---', '---:']));
  for (const y of r.perYear) L.push(row([y.year, y.messages]));
  L.push('');

  L.push('## Sender kinds (core/senders)', '');
  L.push(row(['Kind', 'Messages', '%']), row(['---', '---:', '---:']));
  for (const k of r.senderKinds) L.push(row([k.kind, k.messages, `${k.pct}%`]));
  L.push('');
  L.push(`Automated/machine share: **${r.machineSharePct}%** of all messages.`);
  L.push('');

  L.push(`## Rules classifier over non-machine mail (${r.nonMachine} messages)`, '');
  L.push('Classified per message, not per thread opener — a streaming pass has no threads, so');
  L.push('reply-heavy categories weigh more here than in the per-group analyser.', '');
  L.push(row(['Metric', 'Value']), row(['---', '---']));
  L.push(row(['Vendor noise', `${r.vendorNoise} (${r.vendorNoisePct}%)`]));
  L.push(row(['Safeguarding hits (count only)', r.safeguardingHits]));
  L.push('');
  L.push('### Categories', '');
  L.push(row(['Category', 'Messages']), row(['---', '---:']));
  for (const c of r.categories) L.push(row([categoryDef(c.key)?.label ?? c.key, c.messages]));
  L.push('');
  L.push('### Urgency', '');
  L.push(row(['Urgency', 'Messages']), row(['---', '---:']));
  for (const u of r.urgencies) L.push(row([u.key, u.messages]));
  L.push('');
  L.push('### Confidence', '');
  L.push(row(['Confidence', 'Messages']), row(['---', '---:']));
  for (const c of r.confidences) L.push(row([c.key, c.messages]));
  L.push('');

  L.push('## Address conventions (QM-D40) — school-domain senders', '');
  L.push('The `p.` / `s.` / `a<year>.` account conventions, tested against the real estate.', '');
  L.push(row(['Convention', 'Messages', 'Distinct senders']), row(['---', '---:', '---:']));
  L.push(row(['`p.` (parent)', r.conventions.p.messages, r.conventions.p.senders]));
  L.push(row(['`s.` (enrolled student)', r.conventions.s.messages, r.conventions.s.senders]));
  L.push(row(['`a<year>.` (alumnus)', r.conventions.alum.messages, r.conventions.alum.senders]));
  L.push(row(['other (staff / system)', r.conventions.other.messages, r.conventions.other.senders]));
  L.push('');
  L.push('### Per domain', '');
  L.push(row(['Domain', '`p.`', '`s.`', '`a<year>.`', 'other']), row(['---', '---:', '---:', '---:', '---:']));
  for (const d of r.conventions.byDomain) L.push(row([d.domain, d.p, d.s, d.alum, d.other]));
  L.push('');
  L.push(`### Local-part shapes matching no convention (letters → x, digits → n; at most ${SHAPE_CAP} distinct)`, '');
  L.push('A local-part is usually a person\'s name; the shape is the only safe thing to print.', '');
  if (!r.conventions.otherShapes.length) L.push('_None._');
  for (const s of r.conventions.otherShapes) L.push(`- \`${s}\``);
  L.push('');

  L.push('## Arrival time (IST, +05:30)', '');
  L.push(row(['Hour', 'All', 'Parent+student']), row(['---', '---:', '---:']));
  for (let h = 0; h < 24; h++) {
    L.push(row([String(h).padStart(2, '0'), r.hourOfDayIst[h], r.hourOfDayIstFamily[h]]));
  }
  L.push('');
  L.push(`Arriving 06:00–09:00: **${r.share0609AllPct}%** of all dated mail, **${r.share0609FamilyPct}%** of`);
  L.push('parent+student mail — the deck\'s "26% before the desk is staffed" claim, re-cut over the full archive.');
  L.push('');

  L.push('## Threads (approximate)', '');
  L.push('Keyed on normalised subject (Re:/Fwd: stripped) — an mbox export has no Gmail threadId,');
  L.push('so same-subject messages from different senders merge: counts read slightly low, depths');
  L.push('slightly deep. Aggregate-grade only. Never read coordination out of this section.');
  L.push('');
  L.push(row(['Metric', 'Value']), row(['---', '---']));
  L.push(row(['Threads', r.threads.count]));
  L.push(row(['Max depth', r.threads.maxDepth]));
  for (const d of r.threads.depth) L.push(row([`Depth ${d.bucket}`, d.threads]));
  L.push('');

  if (r.deliveryLists.length) {
    L.push('## Delivery lists', '');
    L.push('Which mailing lists delivered this mail, by domain. A list\'s local part is a team or');
    L.push('role name and is never printed — only its domain and whether it is a front-desk list.');
    L.push('This is how a reader knows WHOSE desk mail the report describes.', '');
    L.push(row(['List domain', 'Front-desk list', 'Lists', 'Messages']),
           row(['---', ':---:', '---:', '---:']));
    for (const d of r.deliveryLists) {
      L.push(row([d.domain, d.deskList ? 'yes' : 'no', d.lists, d.messages]));
    }
    L.push('');
  }

  if (r.streams.length) {
    L.push('## Notification streams (FYI candidates)', '');
    L.push('Subject families: the redacted subject with `Re:`/`Fwd:` stripped and every digit run');
    L.push('flattened to «n», so six years of one annual campaign collapse into ONE row instead of');
    L.push('six. A family that is overwhelmingly machine-sent is a candidate for a separate');
    L.push('reference stream — the desk needs to be able to LOOK IT UP, not read it, and none of it');
    L.push('should enter the working queue. **Replies is the counter-signal**: a family that draws');
    L.push('replies still needs a human path back in, however automated its notifications are.', '');
    L.push(`Families of ${STREAM_MIN}+ messages, top ${STREAM_ROWS} by volume.`, '');
    L.push(row(['Family', 'Messages', 'Machine', 'Replies', 'Years']),
           row(['---', '---:', '---:', '---:', '---']));
    for (const s of r.streams) {
      const years = s.firstYear == null ? 'n/a'
        : s.firstYear === s.lastYear ? String(s.firstYear)
        : `${s.firstYear}–${s.lastYear}`;
      L.push(row([cell(s.family), s.messages, `${s.machinePct}%`, s.replies, years]));
    }
    L.push('');
  }

  L.push('## Top subjects (redacted)', '');
  L.push(row(['Subject', 'Messages']), row(['---', '---:']));
  for (const s of r.topSubjects) L.push(row([cell(s.subject), s.messages]));
  L.push('');
  return L;
}

// ---------------------------------------------------------------------------- runner
export interface TakeoutOptions {
  /** A single .mbox file, or a directory to recurse — Takeout exports nest their mboxes. */
  input: string;
  /** Report path. Defaults to <repo-root>/analysis/takeout-report.md — analysis/ is gitignored. */
  out?: string;
  /** Stop after N messages: smoke runs before committing to the full pass. */
  limit?: number;
  /**
   * Keep only messages whose list/recipient headers match this case-insensitive regex.
   * Exists because a member-mailbox export mixes the group's traffic with that member's
   * other mail; measured on the real archive, list+recipient headers kept 2,194 of 2,195
   * known desk-stream messages. Use a handle pattern (e.g. "front[-._ ]?desk"), not a full
   * address — the pattern is printed into the report, where an address would trip the gate.
   */
  match?: string;
  /**
   * Count each Message-ID once across the whole run. Essential when the input spans several
   * MEMBERS' mailboxes: every member of a group holds that group's mail, so the same message
   * appears in each of their exports and would otherwise be counted once per member. Measured
   * on the 2026-08-08 archive, the three mailboxes overlapped by 196/868/6,293 messages.
   * Messages with no Message-ID are always kept — absence of an id is not proof of a repeat.
   */
  dedupe?: boolean;
}

export interface TakeoutResult {
  outPath: string;
  /** How many .mbox files were read. */
  files: number;
  report: TakeoutReport;
}

/** A Takeout export nests its mbox files ("Takeout/Mail/…"); accept a file or a whole tree. */
function findMboxFiles(input: string): string[] {
  if (statSync(input).isFile()) return [input]; // pointed at a specific file — trust the caller
  const found: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.mbox$/i.test(name)) found.push(full);
    }
  };
  walk(input);
  return found.sort();
}

/**
 * The gate. Every single line, before anything touches disk; one hit aborts the whole run.
 * The error names the LINE NUMBER, never the line — printing the leak into a console
 * scrollback would defeat the point of refusing to write it. Exported so the test can poison
 * it directly: after the shape rule stopped emitting digits there is no NATURAL input that
 * reaches this gate — it exists precisely for the regression nobody anticipated, which is
 * also why it cannot be tested through the front door.
 */
export function assertReportSafe(lines: string[]): void {
  lines.forEach((line, i) => {
    const hits = residualPii(line);
    if (hits.length) {
      throw new Error(
        `REFUSING TO WRITE — residual identifiers (${hits.join(', ')}) at report line ${i + 1}. `
        + 'Nothing has been written. Tighten tools/mbox/redact.ts (or the shape rule) and re-run.',
      );
    }
  });
}

export async function runTakeout(opts: TakeoutOptions): Promise<TakeoutResult> {
  const input = resolve(opts.input);
  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);
  const files = findMboxFiles(input);
  if (!files.length) {
    throw new Error(`No .mbox files under ${input} — point at a Takeout export directory or a single .mbox.`);
  }

  // analysis/ is gitignored at the repo root, so even a session-end catch-all `git add -A`
  // cannot pick the report up. The report must never land anywhere tracked.
  const outPath = resolve(
    opts.out ?? join(__dirname, '..', '..', '..', 'analysis', 'takeout-report.md'),
  );

  let matcher: RegExp | null = null;
  if (opts.match != null) {
    try { matcher = new RegExp(opts.match, 'i'); }
    catch (e) { throw new Error(`--match is not a valid regex: ${e instanceof Error ? e.message : e}`); }
  }
  // Filtering is HEADERS-ONLY and happens before ingest — a skipped message's body goes
  // nowhere, exactly like a kept one's. List headers catch group-delivered mail; recipient
  // headers catch mail addressed to the desk directly (451 such in the real archive).
  // Received is deliberately excluded: its relay chatter matches almost anything.
  const MATCH_KEYS = ['list-id', 'mailing-list', 'x-original-to', 'delivered-to', 'to', 'cc'];
  const headerBlob = (raw: RawMessage) =>
    MATCH_KEYS.map(k => (raw.headersAll[k] ?? []).join(' ')).join(' ');

  // Hashed rather than stored raw: bounded memory over a six-figure archive, and no register
  // of real Message-IDs is held longer than the run needs.
  const seen = opts.dedupe ? new Set<string>() : null;
  let duplicatesDropped = 0;
  let withoutMessageId = 0;

  const agg = newAgg();
  // `scanned` counts messages READ; kept messages are agg.messages. Progress and --limit run
  // on scanned, so a filtered smoke still bounds work done, not work kept.
  let scanned = 0;
  // "Limited" means the limit actually STOPPED the read — the check runs with an unread
  // message in hand, so reaching it proves the archive had more. A --limit larger than the
  // archive is a complete pass and must not be labelled a smoke sample.
  let hitLimit = false;
  reading:
  for (const file of files) {
    for await (const raw of readMbox(file)) {
      if (opts.limit != null && scanned >= opts.limit) { hitLimit = true; break reading; }
      scanned++;
      if (scanned % 5000 === 0) console.error(`  … ${scanned} messages`);
      if (matcher && !matcher.test(headerBlob(raw))) continue;
      if (seen) {
        const mid = (raw.headers['message-id'] ?? '').trim().toLowerCase();
        if (!mid) {
          withoutMessageId++;
        } else {
          const key = createHash('sha1').update(mid).digest('hex').slice(0, 16);
          if (seen.has(key)) { duplicatesDropped++; continue; }
          seen.add(key);
        }
      }
      ingest(agg, raw);
    }
  }

  const report = summarise(agg, {
    // Even file names get redacted: a Group's export can be named after its address.
    sourceFiles: files.map(f => redact(basename(f))),
    limited: hitLimit,
    filter: matcher ? { pattern: opts.match!, scanned, kept: agg.messages } : undefined,
    dedupe: seen ? { duplicatesDropped, withoutMessageId } : undefined,
  });
  const lines = renderMarkdown(report);
  assertReportSafe(lines);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  return { outPath, files: files.length, report };
}

// ---------------------------------------------------------------------------- CLI
function cliMain(): void {
  const argv = process.argv.slice(2);
  // Every flag here takes a value, so the token after a --flag is its value, never the
  // input path — `--limit 50 export.mbox` must resolve to export.mbox, not "50".
  // …except the valueless ones, which must not swallow the token after them.
  const BOOLEAN_FLAGS = new Set(['--dedupe']);
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (BOOLEAN_FLAGS.has(argv[i])) continue;
    if (argv[i].startsWith('--')) { i++; continue; }
    positionals.push(argv[i]);
  }
  const input = positionals[0];
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!input) {
    console.error('usage: npm run takeout -- <export.mbox | takeout-dir> [--out <report.md>] [--limit N] [--match <header-regex>] [--dedupe]');
    process.exit(1);
  }
  const limitRaw = flag('limit');
  const limit = limitRaw != null ? Number(limitRaw) : undefined;
  if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
    console.error(`--limit must be a positive number, got "${limitRaw}"`);
    process.exit(1);
  }

  runTakeout({ input, out: flag('out'), limit, match: flag('match'), dedupe: argv.includes('--dedupe') })
    .then(r => {
      // Counts and the output path only — the console must stay as shareable as the report.
      const f = r.report.filter;
      console.error(`\nRead ${f ? f.scanned : r.report.messages} messages from ${r.files} mbox file(s).`);
      if (f) console.error(`Header filter kept ${f.kept} messages — the report covers only those.`);
      if (r.report.dedupe) console.error(`Dropped ${r.report.dedupe.duplicatesDropped} duplicate(s) by Message-ID.`);
      console.error(`Machine share ${r.report.machineSharePct}%; ~${r.report.threads.count} threads (subject-keyed).`);
      console.error(`Wrote ${r.outPath}`);
    })
    .catch(e => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(/REFUSING TO WRITE/.test(String(e)) ? 2 : 1);
    });
}

// Wrapped in a function rather than top-level await (this package is CJS; tsx cannot emit
// top-level await for a CJS target), and gated so importing runTakeout from a test never
// runs the CLI. The typeof guards keep the file loadable under Vitest's ESM transform,
// where `require` may not exist.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  cliMain();
}
