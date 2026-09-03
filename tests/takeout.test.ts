// tests/takeout.test.ts — the Takeout intake runner, end to end over synthetic mboxes.
//
// Everything here is fabricated: NATO-set identities, phones from the reserved 9900000xxx
// block, student ids in the reserved 2099 joining year (no-real-data.test.ts scans this file
// too — take new values from those ranges, never widen the guard). The tests exercise the two
// safety properties that matter most before the real export lands: nothing identifying
// survives into the report, and a survivor ABORTS the whole run.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertReportSafe, runTakeout } from '../tools/mbox/takeout';

let seq = 0;
/** One synthetic mbox message. Dates carry an explicit offset so IST bucketing is deterministic. */
function msg(o: {
  from: string; name?: string; subject: string; date?: string; body?: string;
  to?: string; listId?: string; messageId?: string;
}): string[] {
  return [
    `From ${o.from} Wed Aug  5 08:00:00 2026`,
    `Message-ID: ${o.messageId ?? `<m${++seq}@fixture.test>`}`,
    `From: "${o.name ?? ''}" <${o.from}>`,
    `To: ${o.to ?? 'frontdesk@fsksurat.in'}`,
    ...(o.listId ? [`List-ID: ${o.listId}`] : []),
    `Subject: ${o.subject}`,
    `Date: ${o.date ?? 'Wed, 5 Aug 2026 10:00:00 +0530'}`,
    '',
    o.body ?? 'Synthetic fixture body.',
    '',
  ];
}
const mbox = (...messages: string[][]) => messages.flat().join('\n');

describe('runTakeout', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fd-takeout-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const out = () => join(dir, 'report.md');

  it('counts p./s./a2099. senders, machines and QM-D40 conventions', async () => {
    const file = join(dir, 'estate.mbox');
    writeFileSync(file, mbox(
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
            subject: 'Request for bonafide certificate',
            body: 'Kindly issue a bonafide certificate for my ward.' }),
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
            subject: 'Re: Request for bonafide certificate',
            body: 'Any update on the bonafide certificate?' }),
      msg({ from: 'p.golf.sample@fsksurat.in', name: 'Parents of Golf Sample',
            subject: 'Serious concern: child left unattended at the bus stop',
            body: 'Nobody was there to receive my child at the stop.' }),
      msg({ from: 's.bravo.sample@fwgs.in', name: 'Bravo Sample',
            subject: 'Question about the science fair', body: 'When is the science fair?' }),
      msg({ from: 'a2099.charlie.sample@fwgs.in', name: 'Charlie Sample',
            subject: 'Bonafide certificate for college',
            body: 'Requesting a bonafide certificate for admissions.' }),
      msg({ from: 'forms-receipts@fsksurat.in', name: 'Student Exit Pass',
            subject: 'Student Exit Pass - New Form filled for Delta Sample (Grade 8 - Zeta) (FSK2099002)',
            body: 'THIS EMAIL IS GENERATED automatically.' }),
      msg({ from: 'donotreply@fsksurat.in', subject: 'Daily report', body: 'Automated daily report.' }),
      msg({ from: 'sales@vendor.test', name: 'A Vendor',
            subject: 'Introducing our platform - book a demo',
            body: 'Our proposal and pricing brochure.' }),
      msg({ from: 'xray.yankee@fsksurat.in', subject: 'Duty roster for August',
            body: 'Roster attached below.' }),
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });

    const kinds = Object.fromEntries(r.report.senderKinds.map(k => [k.kind, k.messages]));
    expect(kinds).toEqual({ parent: 3, student: 1, alumnus: 1, machine: 2, staff: 1, external: 1 });
    expect(r.report.machineSharePct).toBeCloseTo(22.2, 1);

    // QM-D40 conventions over school-domain senders only (the vendor sits outside them).
    expect(r.report.conventions.p).toEqual({ messages: 3, senders: 2 });
    expect(r.report.conventions.s).toEqual({ messages: 1, senders: 1 });
    expect(r.report.conventions.alum).toEqual({ messages: 1, senders: 1 });
    expect(r.report.conventions.other).toEqual({ messages: 3, senders: 3 });
    expect(r.report.conventions.byDomain.find(d => d.domain === 'fsksurat.in'))
      .toMatchObject({ p: 3, s: 0, alum: 0, other: 3 });
    expect(r.report.conventions.byDomain.find(d => d.domain === 'fwgs.in'))
      .toMatchObject({ p: 0, s: 1, alum: 1, other: 0 });

    // Rules classifier over the 7 non-machine messages: vendor noise + safeguarding COUNT only.
    expect(r.report.nonMachine).toBe(7);
    expect(r.report.vendorNoise).toBe(1);
    expect(r.report.safeguardingHits).toBe(1);
    const cats = Object.fromEntries(r.report.categories.map(c => [c.key, c.messages]));
    expect(cats['certificates']).toBe(3); // two parent mails + the alumnus records path
    expect(cats['child-safety']).toBe(1);

    // The machine notification's child never reaches the report, in any fragment.
    const text = readFileSync(r.outPath, 'utf8');
    expect(text).not.toMatch(/FSK2099/);
    expect(text).not.toMatch(/Alpha|Bravo|Charlie|Delta|Zeta/);
  });

  it('prints only SHAPES for school-domain local-parts matching no convention, capped at 20', async () => {
    const file = join(dir, 'shapes.mbox');
    // 25 unknowns of distinct letter-LENGTHS overflow the cap (digits flatten to 'n', so
    // numbered variants would all collapse into one shape); the two named ones come first so
    // their shapes land.
    const overflow = Array.from({ length: 25 }, (_, i) =>
      msg({ from: `${'z'.repeat(i + 3)}.whiskey@fsksurat.in`, subject: 'Circular' }));
    writeFileSync(file, mbox(
      msg({ from: 'xray.yankee@fsksurat.in', subject: 'Duty roster' }),
      msg({ from: 'kilo2098@fsksurat.in', subject: 'Stores note' }),
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample', subject: 'A query about timings' }),
      ...overflow,
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    expect(r.report.conventions.otherShapes).toContain('xxxx.xxxxxx'); // xray.yankee, letters flattened
    expect(r.report.conventions.otherShapes).toContain('xxxxnnnn');    // kilo2098 — digits flattened too
    expect(r.report.conventions.otherShapes.length).toBe(20);          // the cap held

    const text = readFileSync(r.outPath, 'utf8');
    expect(text).not.toMatch(/xray|yankee|kilo|zulu|whiskey/i);        // no unknown local-part letters, ever
    expect(text).not.toMatch(/2098/);                                  // …and no local-part digits either
    expect(text).toContain('`xxxx.xxxxxx`');
    expect(text).toContain('`xxxxnnnn`');
  });

  it('redacts a planted phone and student id out of the report text', async () => {
    const file = join(dir, 'pii.mbox');
    writeFileSync(file, mbox(
      msg({ from: 'p.echo.sample@fsksurat.in', name: 'Parents of Echo Sample',
            subject: 'Please call 9900000123 about FSK2099001',
            body: 'Reach us on 9900000123. Ward id FSK2099001.' }),
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    const text = readFileSync(r.outPath, 'utf8');
    expect(text).not.toContain('9900000123');
    expect(text).not.toContain('FSK2099001');
    expect(text).toContain('«phone»');
    expect(text).toContain('«student-id»');
  });

  it('buckets arrivals by IST hour and computes the 06:00–09:00 desk-hours share', async () => {
    const file = join(dir, 'hours.mbox');
    const at = (t: string) => `Wed, 5 Aug 2026 ${t}`;
    writeFileSync(file, mbox(
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
            subject: 'Morning note one', date: at('07:10:00 +0530') }),
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
            subject: 'Morning note two', date: at('07:20:00 +0530') }),
      msg({ from: 'p.bravo.sample@fsksurat.in', name: 'Parents of Bravo Sample',
            subject: 'Morning note three', date: at('07:45:00 +0530') }),
      msg({ from: 'p.bravo.sample@fsksurat.in', name: 'Parents of Bravo Sample',
            subject: 'Afternoon note', date: at('14:00:00 +0530') }),
      // A UTC-stamped staff message: 05:00Z is 10:30 IST — the conversion, not the raw hour.
      msg({ from: 'lima.mike@fsksurat.in', subject: 'Internal circular', date: at('05:00:00 +0000') }),
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    expect(r.report.hourOfDayIst[7]).toBe(3);
    expect(r.report.hourOfDayIst[14]).toBe(1);
    expect(r.report.hourOfDayIst[10]).toBe(1);          // the +0000 message, shifted to IST
    expect(r.report.share0609AllPct).toBe(60);          // 3 of 5 dated messages
    expect(r.report.share0609FamilyPct).toBe(75);       // 3 of 4 parent messages — the deck's re-cut
  });

  it('stops at --limit messages and marks the report as a limited run', async () => {
    const file = join(dir, 'limit.mbox');
    writeFileSync(file, mbox(
      ...Array.from({ length: 6 }, (_, i) =>
        msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample', subject: `Note ${i + 1}` })),
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out(), limit: 3 });
    expect(r.report.messages).toBe(3);
    expect(r.report.limited).toBe(true);
    expect(readFileSync(r.outPath, 'utf8')).toContain('Limited run');

    // A --limit the archive never reaches is a COMPLETE pass, not a smoke sample.
    const full = await runTakeout({ input: file, out: out(), limit: 100 });
    expect(full.report.messages).toBe(6);
    expect(full.report.limited).toBe(false);
    expect(readFileSync(full.outPath, 'utf8')).not.toContain('Limited run');
  });

  it('recurses a directory to find every .mbox — Takeout exports nest them', async () => {
    mkdirSync(join(dir, 'export', 'nested'), { recursive: true });
    writeFileSync(join(dir, 'export', 'a.mbox'), mbox(
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample', subject: 'First' }),
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample', subject: 'Second' }),
    ), 'utf8');
    writeFileSync(join(dir, 'export', 'nested', 'b.mbox'), mbox(
      msg({ from: 's.bravo.sample@fwgs.in', name: 'Bravo Sample', subject: 'Third' }),
    ), 'utf8');
    writeFileSync(join(dir, 'export', 'notes.txt'), 'not an mbox', 'utf8');

    const r = await runTakeout({ input: join(dir, 'export'), out: out() });
    expect(r.files).toBe(2);
    expect(r.report.messages).toBe(3);
  });

  it('keeps only messages whose list/recipient headers match --match, headers-only', async () => {
    // A member-mailbox export mixes the group's mail with the member's other lists and
    // direct mail. The filter keys on list/recipient headers: group-delivered desk mail
    // (List-ID), direct-addressed desk mail (To), and drops the rest — including a message
    // that merely TALKS about the desk in subject or body, which is not desk-addressed mail.
    const file = join(dir, 'member-mailbox.mbox');
    writeFileSync(file, mbox(
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
            subject: 'Bus timing query' }),                                    // To: frontdesk@… (default)
      msg({ from: 'donotreply@fsksurat.in', subject: 'Missed call digest',
            to: 'xray.yankee@fsksurat.in', listId: '<frontdesk.fsksurat.in>' }), // via the desk group
      msg({ from: 'p.bravo.sample@fsksurat.in', name: 'Parents of Bravo Sample',
            subject: 'Fees receipt', to: 'accounts-desk-team@fsksurat.in',
            listId: '<accounts.fsksurat.in>' }),                               // another list — dropped
      msg({ from: 'xray.yankee@fsksurat.in', subject: 'Ask the front desk about couriers',
            to: 'lima.mike@fsksurat.in',
            body: 'The front desk keeps the courier register.' }),             // mentions ≠ addressed
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out(), match: 'front[-._ ]?desk' });
    expect(r.report.filter).toEqual({ pattern: 'front[-._ ]?desk', scanned: 4, kept: 2 });
    expect(r.report.messages).toBe(2);
    const kinds = Object.fromEntries(r.report.senderKinds.map(k => [k.kind, k.messages]));
    expect(kinds).toEqual({ parent: 1, machine: 1 });
    const text = readFileSync(r.outPath, 'utf8');
    expect(text).toContain('kept 2 of 4 messages scanned');

    // 'accounts-desk-team' must NOT have matched above: the pattern needs "front" and
    // "desk" adjacent, so a desk-ish other list stays dropped. And an unfiltered run is
    // unchanged: everything read, no Filter line in the report.
    const full = await runTakeout({ input: file, out: out() });
    expect(full.report.messages).toBe(4);
    expect(full.report.filter).toBeUndefined();
    expect(readFileSync(full.outPath, 'utf8')).not.toContain('Filter:');
  });

  it('counts a Message-ID once across files under --dedupe, and never drops an id-less message', async () => {
    // The real hazard this exists for: an export spanning several MEMBERS of one group. Each
    // member's mailbox holds the group's mail, so without dedupe a message is counted once
    // per member and every statistic inflates.
    mkdirSync(join(dir, 'two'), { recursive: true });
    const shared = { from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
                     subject: 'Bus stop change', messageId: '<shared-1@fixture.test>' };
    writeFileSync(join(dir, 'two', 'memberA.mbox'), mbox(
      msg(shared),
      msg({ from: 'p.bravo.sample@fsksurat.in', name: 'Parents of Bravo Sample', subject: 'Only in A' }),
    ), 'utf8');
    writeFileSync(join(dir, 'two', 'memberB.mbox'), mbox(
      msg(shared),                                                     // same message, other mailbox
      msg({ from: 'p.golf.sample@fsksurat.in', name: 'Parents of Golf Sample', subject: 'Only in B' }),
      // No Message-ID at all: absence of an id is not proof of a repeat, so it must be kept —
      // even though a second id-less message looks identical to this one.
      ['From p.echo.sample@fsksurat.in Wed Aug  5 08:00:00 2026',
       'From: "Parents of Echo Sample" <p.echo.sample@fsksurat.in>',
       'To: frontdesk@fsksurat.in', 'Subject: No id here',
       'Date: Wed, 5 Aug 2026 10:00:00 +0530', '', 'Body.', ''],
    ), 'utf8');

    const r = await runTakeout({ input: join(dir, 'two'), out: out(), dedupe: true });
    expect(r.report.messages).toBe(4);                                 // 5 read, 1 repeat dropped
    expect(r.report.dedupe).toEqual({ duplicatesDropped: 1, withoutMessageId: 1 });
    expect(readFileSync(r.outPath, 'utf8')).toContain('1 repeat(s) dropped');

    // Without the flag the repeat is counted twice — the inflation the flag exists to stop.
    const dup = await runTakeout({ input: join(dir, 'two'), out: out() });
    expect(dup.report.messages).toBe(5);
    expect(dup.report.dedupe).toBeUndefined();
  });

  it('reports delivery lists by domain and desk-ness, never the list local part', async () => {
    const file = join(dir, 'lists.mbox');
    writeFileSync(file, mbox(
      msg({ from: 'donotreply@fsksurat.in', subject: 'Exit pass', listId: '<frontdesk.fsksurat.in>' }),
      msg({ from: 'donotreply@fsksurat.in', subject: 'Sickbay', listId: 'Desk <frontdesk.fsksurat.in>' }),
      msg({ from: 'donotreply@fwgs.in', subject: 'Exit pass', listId: '<frontdesk.fwgs.in>' }),
      msg({ from: 'xray.yankee@fsksurat.in', subject: 'Circular', listId: '<allstaff.fsksurat.in>' }),
      msg({ from: 'lima.mike@fsksurat.in', subject: 'Roster' }),           // no list at all
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    expect(r.report.deliveryLists).toEqual([
      { domain: 'fsksurat.in', deskList: true, lists: 1, messages: 2 },
      { domain: 'fwgs.in', deskList: true, lists: 1, messages: 1 },
      { domain: 'fsksurat.in', deskList: false, lists: 1, messages: 1 },
    ]);

    const text = readFileSync(r.outPath, 'utf8');
    expect(text).toContain('## Delivery lists');
    expect(text).not.toMatch(/frontdesk|allstaff/i);   // domains yes, list local parts never
  });

  it('groups subject families into notification streams, flattening digits across years', async () => {
    // The FYI question: which families are machine-sent noise the desk should look up rather
    // than read? Six years of one annual campaign must read as ONE family — that is the whole
    // point of flattening digits, and the top-subjects table cannot show it.
    const file = join(dir, 'streams.mbox');
    const campaign = (year: string, n: number) => Array.from({ length: n }, () =>
      msg({ from: 'donotreply@fsksurat.in', subject: `ID card verification details ${year}` }));
    const replies = Array.from({ length: 5 }, () =>
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample',
            subject: 'Re: ID card verification details 2026-27' }));
    const rare = Array.from({ length: 3 }, () =>
      msg({ from: 'p.bravo.sample@fsksurat.in', name: 'Parents of Bravo Sample',
            subject: 'A one-off question about timings' }));
    writeFileSync(file, mbox(
      ...campaign('2025-26', 14), ...campaign('2026-27', 12), ...replies, ...rare,
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    const fam = r.report.streams.find(s => /ID card/i.test(s.family));
    expect(fam?.family).toBe('ID card verification details «n»');   // both years, one row
    expect(fam?.messages).toBe(31);                                  // 14 + 12 + 5 replies
    expect(fam?.replies).toBe(5);                                    // the counter-signal
    expect(fam?.machinePct).toBeCloseTo(83.9, 1);                    // 26 of 31 machine-sent

    // A handful of messages is a coincidence, not a stream — it must not reach the report.
    expect(r.report.streams.some(s => /one-off/i.test(s.family))).toBe(false);
    expect(readFileSync(r.outPath, 'utf8')).toContain('## Notification streams');
  });

  it('approximates threads on normalised subject and reports depth stats', async () => {
    const file = join(dir, 'threads.mbox');
    writeFileSync(file, mbox(
      msg({ from: 'p.alpha.sample@fsksurat.in', name: 'Parents of Alpha Sample', subject: 'Bus stop change' }),
      msg({ from: 'p.bravo.sample@fsksurat.in', name: 'Parents of Bravo Sample', subject: 'Re: Bus stop change' }),
      msg({ from: 'p.golf.sample@fsksurat.in', name: 'Parents of Golf Sample', subject: 'RE: Fwd: Bus stop change' }),
      msg({ from: 's.charlie.sample@fwgs.in', name: 'Charlie Sample', subject: 'Sports day query' }),
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    expect(r.report.threads.count).toBe(2);
    expect(r.report.threads.maxDepth).toBe(3);
    expect(r.report.threads.depth.find(d => d.bucket === '3–5')?.threads).toBe(1);
    expect(r.report.threads.depth.find(d => d.bucket === '1')?.threads).toBe(1);
  });

  it('defuses a phone-number local-part by shape alone — the leak verification proved', async () => {
    // Verification of the first cut showed digit-preserving shapes leaking identifier runs
    // ('fsk2099001' → 'xxx2099001'; a 12-digit account printed verbatim past the phone
    // pattern's \b). Digits now flatten to 'n', so these accounts produce inert shapes and
    // the run completes — the report carries the SHAPE, never the number.
    const file = join(dir, 'leak.mbox');
    writeFileSync(file, mbox(
      msg({ from: '9900000123@fsksurat.in', subject: 'Hello' }),
      msg({ from: 'fsk2099001@fsksurat.in', subject: 'Hello again' }),
    ), 'utf8');

    const r = await runTakeout({ input: file, out: out() });
    expect(r.report.conventions.otherShapes).toContain('nnnnnnnnnn');
    expect(r.report.conventions.otherShapes).toContain('xxxnnnnnnn');
    const text = readFileSync(r.outPath, 'utf8');
    expect(text).not.toContain('9900000123');
    expect(text).not.toContain('2099001');
  });

  it('assertReportSafe refuses a poisoned line, naming the line number and never the content', () => {
    // With shapes digit-free there is no NATURAL input that reaches this gate — it exists
    // for the regression nobody anticipated, so it is tested at its own seam.
    expect(() => assertReportSafe(['Totals', 'Call 9900000123 today']))
      .toThrow(/REFUSING TO WRITE.*\(phone\).*line 2/);
    expect(() => assertReportSafe(['Ward FSK2099001'])).toThrow(/student-id/);
    expect(() => assertReportSafe(['| parent | 41 | 12.3% |', '`xxxx.xxxxxx`'])).not.toThrow();
  });
});
