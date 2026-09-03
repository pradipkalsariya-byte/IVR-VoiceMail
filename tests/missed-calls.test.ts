import { describe, it, expect } from 'vitest';
import {
  isMissedCallReport, istClockLabel, missedCallRowMessageId, parseIstDateTime,
  parseMissedCallReport,
} from '../core/missed-calls';
import { explodeMissedCallReport, planIngest, type IngestContext } from '../core/ingest';
import { FAKE_MISSED_CALL_REPORT } from '../lib/ingest/fake';

// SYNTHETIC ONLY (cardinal rule 2): every caller number below is from the reserved
// 9900000xxx block. The SHAPE is the vendor's real one, validated against 2,672 archived
// reports on 2026-08-08 — an HTML table, two layouts, `YYYY-MM-DD HH:MM:SS` IST datetimes.
const REPORT_SENT = new Date('2026-08-07T05:00:00Z'); // 10:30 IST

const row = (...cells: string[]) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const table = (header: string[], ...rows: string[]) =>
  `<html><body><p>Missed Call Report</p><table>`
  + `<tr>${header.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}`
  + `</table></body></html>`;

/** The vendor's 'callback' layout — the one that knows whether the desk rang back. */
const CALLBACK_HEADER = ['Source', 'Destination', 'Misscall Time', 'Callback Status', 'Callback Time'];
const CALLBACK_HTML = table(
  CALLBACK_HEADER,
  row('919900000201', '2001', '2026-08-07 10:02:14', 'No Callback', ''),
  row('9900000202', '2002', '2026-08-07 10:11:57', 'Callback Done', '2026-08-07 10:15:02'),
  row('12345', '2001', '2026-08-07 10:14:00', 'No Callback', ''),          // caller too short
  row('919900000203', '2001', '2026-08-07 10:19:30', 'No Callback', ''),
);

/** The vendor's other current layout — same reports, different columns, caller in column 1. */
const CALLLOG_HTML = table(
  ['Call Date', 'Source', 'Destination', 'Disposition', 'Type', 'Duration'],
  row('2026-08-07 10:02:14', '919900000201', '2001', 'NO ANSWER', 'Missed', '00:41'),
  row('2026-08-07 10:11:57', '919900000202', '2002', 'NO ANSWER', 'Missed', '00:12'),
);

describe('parseMissedCallReport — the vendor\'s two real layouts', () => {
  it('reads the callback layout, keeping the last 10 digits of the caller', () => {
    const { format, entries } = parseMissedCallReport(CALLBACK_HTML);
    expect(format).toBe('callback');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      row: 1,
      at: new Date('2026-08-07T04:32:14Z'),   // 10:02:14 IST
      callerPhone: '9900000201',
      destination: '2001',
      callbackDone: false,
    });
  });

  it('reads the calllog layout, where the caller is a DIFFERENT column', () => {
    // The whole reason columns resolve by LABEL: position 0 is the caller in one layout and
    // the timestamp in the other. The old positional parser had it wrong in both.
    const { format, entries } = parseMissedCallReport(CALLLOG_HTML);
    expect(format).toBe('calllog');
    expect(entries.map(e => e.callerPhone)).toEqual(['9900000201', '9900000202']);
    expect(entries[0].at).toEqual(new Date('2026-08-07T04:32:14Z'));
    // No callback column here — false must mean "not known to be returned", never "confirmed
    // outstanding", which is why the flag is documented rather than inferred.
    expect(entries.every(e => e.callbackDone === false)).toBe(true);
  });

  it('carries the vendor\'s callback verdict, with its time', () => {
    const { entries } = parseMissedCallReport(CALLBACK_HTML);
    const done = entries.find(e => e.callbackDone);
    expect(done?.callerPhone).toBe('9900000202');
    expect(done?.callbackAt).toEqual(new Date('2026-08-07T04:45:02Z'));
  });

  it('skips malformed rows with a count, without losing the rows after them', () => {
    const { entries, skipped } = parseMissedCallReport(CALLBACK_HTML);
    expect(skipped).toBe(1);
    // The broken row keeps its place in the numbering: the valid row after it is row 4,
    // matching the row a desk member would count in the mail itself.
    expect(entries[2]).toMatchObject({ row: 4, callerPhone: '9900000203' });
  });

  it('treats the vendor\'s empty-period placeholder as a normal report, not a malformed row', () => {
    // Several hundred of these a year. Counting them as skips would keep the canary lit and
    // train everyone to ignore it.
    const empty = table(CALLBACK_HEADER, row('No Missed Calls.', '', '', '', ''));
    expect(parseMissedCallReport(empty)).toEqual({ format: 'callback', entries: [], skipped: 0 });

    const none = table(['Call Date', 'Source', 'Destination', 'Disposition', 'Type', 'Duration'],
      row('No Records Found', '', '', '', '', ''));
    expect(parseMissedCallReport(none).skipped).toBe(0);
  });

  it('REGRESSION — an unreadable report says so instead of returning a silent zero', () => {
    // The bug this rewrite exists for: against the old pipe-separated assumption the parser
    // returned zero entries AND zero skips on every real report, which is indistinguishable
    // from a quiet half hour. Whatever else changes, that must stay distinguishable.
    const oldAssumedFormat = 'Time | Caller | Duration | Line\n10:02 | 9900000201 | 00:41 | FSK';
    expect(parseMissedCallReport(oldAssumedFormat).format).toBe('unrecognised');
    expect(parseMissedCallReport('').format).toBe('unrecognised');
    // A table whose header matches neither layout is unreadable, not empty.
    expect(parseMissedCallReport(table(['When', 'Who'], row('x', 'y'))).format).toBe('unrecognised');
    // …and a report that genuinely held no calls is NOT 'unrecognised'.
    expect(parseMissedCallReport(table(CALLBACK_HEADER)).format).toBe('callback');
  });

  it('picks the report table out of a template\'s layout tables', () => {
    const wrapped = `<table><tr><td>banner</td></tr>${CALLBACK_HTML}</table>`;
    expect(parseMissedCallReport(wrapped).entries).toHaveLength(3);
  });

  it('is deterministic — the same HTML always yields the same entries', () => {
    expect(parseMissedCallReport(CALLBACK_HTML)).toEqual(parseMissedCallReport(CALLBACK_HTML));
  });
});

describe('parseIstDateTime — the vendor stamps IST with no offset', () => {
  it('reads YYYY-MM-DD HH:MM:SS as IST', () => {
    expect(parseIstDateTime('2026-08-07 10:02:14')).toEqual(new Date('2026-08-07T04:32:14Z'));
    expect(parseIstDateTime('2026-08-07 10:02')).toEqual(new Date('2026-08-07T04:32:00Z'));
  });

  it('rejects anything else rather than guessing', () => {
    expect(parseIstDateTime('10:02')).toBeNull();          // the old assumed shape
    expect(parseIstDateTime('07-08-2026 10:02:14')).toBeNull(); // day-first is not what they send
    expect(parseIstDateTime('2026-02-31 10:02:14')).toBeNull(); // no silent roll-over
    expect(parseIstDateTime('')).toBeNull();
  });

  it('dates each row from its OWN stamp, so a report spanning midnight is right', () => {
    // The old rowInstant() put every row on the report's date. A 23:58 call in a 00:00 report
    // landed a day late; each row now carries its own date and cannot.
    const late = table(CALLBACK_HEADER,
      row('919900000204', '2001', '2026-08-06 23:58:00', 'No Callback', ''));
    expect(parseMissedCallReport(late).entries[0].at).toEqual(new Date('2026-08-06T18:28:00Z'));
  });
});

describe('row identity and timing', () => {
  it('derives the id from the CALL — phone + instant — not the containing report', () => {
    const at = new Date('2026-08-07T04:32:14Z');
    expect(missedCallRowMessageId('9900000201', at)).toBe('missed-call-9900000201-2026-08-07T04:32:14.000Z');
    // Determinism is the dedup guarantee: the same call derives the same id every time.
    expect(missedCallRowMessageId('9900000201', at)).toBe(missedCallRowMessageId('9900000201', at));
  });

  it('gives two different calls two different ids even at the same reported minute', () => {
    const at = new Date('2026-08-07T04:32:00Z');
    expect(missedCallRowMessageId('9900000201', at))
      .not.toBe(missedCallRowMessageId('9900000202', at));
  });

  it('names the report by its IST clock time', () => {
    expect(istClockLabel(REPORT_SENT)).toBe('10:30');
  });
});

describe('isMissedCallReport — recognising the one report type worth exploding', () => {
  it('recognises the Synapse missed-call report', () => {
    expect(isMissedCallReport({
      from: { name: 'Enjay Synapse' }, subject: 'Missed Call Report - Front Desk (10:00 - 10:30)',
    })).toBe(true);
  });

  it('recognises the vendor\'s OTHER spelling — "Misscall"', () => {
    // Found by running the rewritten parser over the archive: the old subject regex accepted
    // only "missed call", which excluded 808 of 1,500 real reports — and they were the ones
    // carrying Callback Status. Both spellings are live, in the same mailbox, in the same year.
    expect(isMissedCallReport({
      from: { name: 'Enjay Synapse' }, subject: 'Daily Misscall Report of 2026-08-05',
    })).toBe(true);
  });

  it('leaves other machine mail alone — even other Synapse summaries', () => {
    expect(isMissedCallReport({ from: { name: 'Google Forms' }, subject: 'Missed call report' })).toBe(false);
    expect(isMissedCallReport({ from: { name: 'Enjay Synapse' }, subject: 'Daily call summary' })).toBe(false);
  });

  it('leaves a HUMAN forward of a report alone', () => {
    // 11 of 1,502 archived matches were staff forwarding a report. They carry no fresh calls,
    // so the exact-display-name gate is doing real work, not being incidentally strict.
    expect(isMissedCallReport({
      from: { name: 'Xray Yankee' }, subject: 'Fwd: Missed Call Report - Front Desk',
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------

const ALIASES = new Map([
  ['frontdesk@fsksurat.in', 'fsk'],
  ['frontdesk@fwgs.in', 'fwgs'],
]);
const ctx = (over: Partial<IngestContext> = {}): IngestContext => ({
  seenMessageIds: new Set(),
  threadToRequest: new Map(),
  aliasToCampus: ALIASES,
  fallbackCampus: 'fsk',
  ...over,
});

describe('the explosion (QM-D14 consequence 1) — per-call captures, nothing auto-queued', () => {
  const report = {
    messageId: '<r-9@synapse.test>',
    subject: 'Missed Call Report - Front Desk (10:00 - 10:30)',
    body: 'Please find the missed call details below.',
    bodyHtml: CALLBACK_HTML,
    sentAt: REPORT_SENT,
  };

  it('turns each outstanding row into an unfiled switchboard call capture', () => {
    const { captures, skippedLines } = explodeMissedCallReport(report, ctx());
    expect(captures).toHaveLength(2);   // 3 parsed, 1 of them already called back
    expect(skippedLines).toBe(1);
    for (const c of captures) {
      expect(c.channel).toBe('call');
      expect(c.isSwitchboard).toBe(true);
      expect(c.status).toBe('unfiled'); // the desk files them — nothing auto-enters the queue
      expect(c.slaDueAt).toBeInstanceOf(Date);
      expect(+c.clockStartsAt).toBeGreaterThanOrEqual(+c.arrivedAt);
    }
  });

  it('does NOT hand the desk a call the vendor already shows as returned', () => {
    // Only 9.5% of real rows carry "Callback Done" — but filing those would be handing back
    // work already done. Counted, never silently dropped.
    const { captures, alreadyCalledBack } = explodeMissedCallReport(report, ctx());
    expect(alreadyCalledBack).toBe(1);
    expect(captures.every(c => !c.subject.includes('9900000202'))).toBe(true);
  });

  it('anchors each capture on the CALL instant, not the report instant', () => {
    const { captures } = explodeMissedCallReport(report, ctx());
    expect(captures[0].arrivedAt).toEqual(new Date('2026-08-07T04:32:14Z'));
    expect(+captures[0].arrivedAt).toBeLessThan(+REPORT_SENT);
  });

  it('never trusts the report\'s own line string for the campus', () => {
    // There is no campus column in either real layout; Destination is an extension. It maps
    // only when it happens to name a campus we know, and otherwise falls back — the same
    // stance the app rail takes on a client-supplied campus id.
    const { captures } = explodeMissedCallReport(report, ctx());
    expect(captures.map(c => c.campusOrgUnitId)).toEqual(['fsk', 'fsk']);

    const named = explodeMissedCallReport(
      { ...report, bodyHtml: table(CALLBACK_HEADER,
          row('919900000205', 'fwgs', '2026-08-07 10:20:00', 'No Callback', '')) },
      ctx(),
    );
    expect(named.captures[0].campusOrgUnitId).toBe('fwgs');
  });

  it('names the source row in the suggestion reason', () => {
    const { captures } = explodeMissedCallReport(report, ctx());
    expect(captures[0].suggestionReason).toMatch(/^Row 1 of the 10:30 missed-call report/);
    expect(captures[1].suggestionReason).toMatch(/^Row 4 of the 10:30 missed-call report/);
    // The honest suggestion: nobody knows what a missed call was about until someone rings back.
    expect(captures[0].suggestedCategory).toBe('unclassified');
  });

  it('derives deterministic sourceMessageIds so a re-pull creates nothing', () => {
    const first = explodeMissedCallReport(report, ctx());
    const again = explodeMissedCallReport(report, ctx());
    expect(first.captures.map(c => c.sourceMessageId)).toEqual([
      'missed-call-9900000201-2026-08-07T04:32:14.000Z',
      'missed-call-9900000203-2026-08-07T04:49:30.000Z',
    ]);
    expect(again).toEqual(first);
  });

  it('REGRESSION (2026-08-12, first live pull) — the SAME call, re-listed in a DIFFERENT ' +
     'report, derives the SAME id instead of exploding into a new duplicate', () => {
    // The vendor's report is cumulative: an outstanding call is re-listed in every subsequent
    // half-hourly report until it's called back (see core/missed-calls.ts). Two report EMAILS
    // (different Message-IDs, as they genuinely are — sent 30 minutes apart) both still
    // showing the same 10:02:14 call, still not called back.
    const reportCycleTwo = { ...report, messageId: '<r-10@synapse.test>', sentAt: new Date('2026-08-07T05:30:00Z') };
    const first = explodeMissedCallReport(report, ctx());
    const second = explodeMissedCallReport(reportCycleTwo, ctx());

    const firstIds = first.captures.map(c => c.sourceMessageId);
    const secondIds = second.captures.map(c => c.sourceMessageId);
    // Identical id sets from two DIFFERENT report Message-IDs — this is what makes
    // lib/ingest/run.ts's `have.has(sourceMessageId)` check correctly skip the second
    // listing instead of creating a sibling Request for the same unresolved call.
    expect(secondIds).toEqual(firstIds);
    // The old (buggy) key would have failed this: it derived from `msg.messageId`, so
    // `<r-9@…>#missed-call-row-1` and `<r-10@…>#missed-call-row-1` never collided.
    expect(secondIds.every(id => !id.includes('synapse.test'))).toBe(true);
  });

  it('reports an unreadable body as unrecognised rather than as an empty report', () => {
    const { captures, skippedLines, format } =
      explodeMissedCallReport({ ...report, body: '', bodyHtml: '' }, ctx());
    expect(captures).toEqual([]);
    expect(skippedLines).toBe(0);
    expect(format).toBe('unrecognised');   // the canary lib/ingest/run.ts turns into an error
  });

  it('still works when a source puts the table in body with no bodyHtml', () => {
    const { captures, format } =
      explodeMissedCallReport({ ...report, body: CALLBACK_HTML, bodyHtml: undefined }, ctx());
    expect(format).toBe('callback');
    expect(captures).toHaveLength(2);
  });
});

describe('the demo fixture rides the same rules', () => {
  it('is recognised, and its callers all come from the reserved synthetic block', () => {
    expect(isMissedCallReport(FAKE_MISSED_CALL_REPORT)).toBe(true);
    const { entries, skipped, format } = parseMissedCallReport(FAKE_MISSED_CALL_REPORT.bodyHtml!);
    expect(format).toBe('callback');
    expect(entries).toHaveLength(3);
    expect(skipped).toBe(0);
    for (const e of entries) expect(e.callerPhone).toMatch(/^9900000\d{3}$/);
  });

  it('carries the table in the HTML part only, exactly as the real reports do', () => {
    expect(FAKE_MISSED_CALL_REPORT.body).not.toMatch(/<table/i);
    expect(parseMissedCallReport(FAKE_MISSED_CALL_REPORT.body).format).toBe('unrecognised');
  });

  it('the report mail ITSELF still parks as machine traffic — only its rows become work', () => {
    const d = planIngest(FAKE_MISSED_CALL_REPORT, ctx());
    if (d.action !== 'create') throw new Error('expected create');
    expect(d.fields.isAutomated).toBe(true);
    expect(d.fields.status).toBe('not_a_request');
    expect(d.fields.slaDueAt).toBeNull(); // nobody owes a robot a reply — the CALLERS get clocks
  });
});

describe('a report listing the same call twice does not lose the rest of the report', () => {
  // Production, hourly, for at least three hours before it was noticed:
  //   "missed-call explosion: Unique constraint failed on the fields: (sourceMessageId)"
  //
  // The id is (phone, timestamp) and nothing more, so a report that lists one caller twice at
  // the same second produces the same id twice. The dedupe set was loaded from the database
  // BEFORE the loop, so it could only catch rows from an earlier pass — and the second create
  // threw, aborting the whole report's explosion and dropping every call after it.
  it('generates one id per (caller, second), so duplicates are detectable', () => {
    const at = new Date('2026-08-27T05:32:00.000Z');
    expect(missedCallRowMessageId('9900000216', at))
      .toBe(missedCallRowMessageId('9900000216', at));
  });

  it('distinguishes two different callers at the same second', () => {
    const at = new Date('2026-08-27T05:32:00.000Z');
    expect(missedCallRowMessageId('9900000216', at))
      .not.toBe(missedCallRowMessageId('9900000217', at));
  });

  it('distinguishes the same caller a second apart', () => {
    expect(missedCallRowMessageId('9900000216', new Date('2026-08-27T05:32:00.000Z')))
      .not.toBe(missedCallRowMessageId('9900000216', new Date('2026-08-27T05:32:01.000Z')));
  });

  it('a within-pass seen-set suppresses the duplicate instead of throwing', () => {
    // The shape of the fix in lib/ingest/run.ts: add to `have` as each row is created.
    const at = new Date('2026-08-27T05:32:00.000Z');
    const rows = ['9900000216', '9900000216', '9900000217']
      .map(p => missedCallRowMessageId(p, at));
    const have = new Set<string>();
    const created: string[] = [];
    for (const id of rows) {
      if (have.has(id)) continue;
      created.push(id);
      have.add(id);
    }
    // Two distinct calls survive; the third row is the duplicate and is skipped, not thrown on.
    expect(created).toHaveLength(2);
  });
});
