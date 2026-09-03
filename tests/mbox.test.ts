import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMbox, buildMessage, parseAddresses, decodeHeaderValue, isSeparator, stripHtml } from '../tools/mbox/parse';
import {
  classifySender, isRollingThread, isParentAddress, isStudentAddress,
  isAlumnusAddress, alumnusGraduationYear,
} from '../core/senders';
import { redact, redactSubject, residualPii } from '../tools/mbox/redact';

// ------------------------------------------------------------------ parser primitives
describe('mbox separators', () => {
  it('recognises a standard From_ line', () => {
    expect(isSeparator('From parent@example.test Wed Aug 05 14:37:27 2026')).toBe(true);
  });
  it('does not treat prose beginning "From" as a separator', () => {
    expect(isSeparator('From the desk of the principal')).toBe(false);
    expect(isSeparator('Fromage is not a separator')).toBe(false);
  });
});

describe('header handling', () => {
  it('unfolds continuation lines', () => {
    const m = buildMessage([
      'Subject: Student Exit Pass - New Form filled',
      '  for Charlie Sample (Grade 8 - Zeta)',
      'From: Student Exit Pass <forms-receipts@fsksurat.in>',
      '',
      'body',
    ]);
    expect(m.headers['subject']).toBe('Student Exit Pass - New Form filled for Charlie Sample (Grade 8 - Zeta)');
  });

  it('decodes RFC 2047 encoded-words', () => {
    expect(decodeHeaderValue('=?UTF-8?B?U2Fmw6l0eQ==?=')).toBe('Saféty');
    expect(decodeHeaderValue('=?utf-8?Q?Half=20day=20leave?=')).toBe('Half day leave');
  });

  it('keeps repeated headers in headersAll', () => {
    const m = buildMessage(['Received: a', 'Received: b', 'Subject: x', '', 'body']);
    expect(m.headersAll['received']).toEqual(['a', 'b']);
    expect(m.headers['received']).toBe('a');
  });
});

describe('body decoding', () => {
  it('decodes quoted-printable', () => {
    const m = buildMessage([
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Bus was 40=20minutes late=',
      ' and nobody called.',
    ]);
    expect(m.text).toContain('40 minutes late');
  });

  it('decodes base64', () => {
    const m = buildMessage([
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('bonafide certificate please').toString('base64'),
    ]);
    expect(m.text.trim()).toBe('bonafide certificate please');
  });

  it('prefers text/plain from multipart/alternative', () => {
    const m = buildMessage([
      'Content-Type: multipart/alternative; boundary="B1"',
      '',
      '--B1',
      'Content-Type: text/plain',
      '',
      'PLAIN VERSION',
      '--B1',
      'Content-Type: text/html',
      '',
      '<p>HTML VERSION</p>',
      '--B1--',
    ]);
    expect(m.text).toContain('PLAIN VERSION');
    expect(m.text).not.toContain('HTML VERSION');
  });

  it('falls back to stripped HTML when there is no plain part', () => {
    const m = buildMessage([
      'Content-Type: multipart/alternative; boundary="B2"',
      '',
      '--B2',
      'Content-Type: text/html',
      '',
      '<div>Dear Parent,<br>Fees are due.</div>',
      '--B2--',
    ]);
    expect(m.text).toContain('Dear Parent');
    expect(m.text).toContain('Fees are due');
    expect(m.text).not.toContain('<div>');
  });

  it('strips scripts and entities from HTML', () => {
    expect(stripHtml('<script>bad()</script><p>Tom &amp; Jerry</p>')).toBe('Tom & Jerry');
  });
});

describe('address parsing', () => {
  it('splits name and address', () => {
    const [a] = parseAddresses('"Parents of Alpha Sample" <p.alpha.sample@fsksurat.in>');
    expect(a.name).toBe('Parents of Alpha Sample');
    expect(a.email).toBe('p.alpha.sample@fsksurat.in');
  });
  it('handles multiple recipients including commas inside quoted names', () => {
    const list = parseAddresses('"Desk, Front" <frontdesk@fwgs.in>, a@b.test, "X" <x@y.test>');
    expect(list).toHaveLength(3);
    expect(list[0].name).toBe('Desk, Front');
  });
  it('handles a bare address', () => {
    expect(parseAddresses('someone@example.test')[0].email).toBe('someone@example.test');
  });
});

// ------------------------------------------------------------------ streaming
describe('streaming a whole mbox', () => {
  let dir: string, file: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fdmbox-'));
    file = join(dir, 'test.mbox');
    writeFileSync(file, [
      'From p.one@fsksurat.in Wed Aug 05 08:09:00 2026',
      'Message-ID: <a@x>',
      'From: "Parents of One Child" <p.one@fsksurat.in>',
      'To: frontdesk@fsksurat.in',
      'Subject: Request for bonafide certificate',
      'Date: Wed, 5 Aug 2026 08:09:00 +0530',
      '',
      'Kindly issue a bonafide certificate.',
      '>From the school gate it is unclear.',   // mboxrd-escaped body line
      '',
      'From forms@fsksurat.in Wed Aug 05 09:00:00 2026',
      'Message-ID: <b@x>',
      'In-Reply-To: <a@x>',
      'From: Student Exit Pass <forms-receipts@fsksurat.in>',
      'Subject: Student Exit Pass - New Form filled for A Child',
      'Date: Wed, 5 Aug 2026 09:00:00 +0530',
      '',
      'THIS EMAIL IS GENERATED automatically.',
      '',
    ].join('\n'), 'utf8');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('yields each message once, with headers and body', async () => {
    const out = [];
    for await (const m of readMbox(file)) out.push(m);
    expect(out).toHaveLength(2);
    expect(out[0].headers['subject']).toBe('Request for bonafide certificate');
    expect(out[1].headers['in-reply-to']).toBe('<a@x>');
  });

  it('unescapes ">From " in the body', async () => {
    const out = [];
    for await (const m of readMbox(file)) out.push(m);
    expect(out[0].text).toContain('From the school gate');
    expect(out[0].text).not.toContain('>From the school gate');
  });
});

// ------------------------------------------------------------------ sender classification
describe('sender classification — the real senders from the archive', () => {
  const c = (name: string, email: string, subject = '', body = '') =>
    classifySender({ name, email, subject, body });

  it('flags Student Exit Pass as machine', () => {
    expect(c('Student Exit Pass', 'forms@fsksurat.in').kind).toBe('machine');
  });
  it('flags every Nucleus-* notifier as machine', () => {
    for (const n of ['Nucleus-ICard', 'Nucleus-Sickbay visit - student', 'Nucleus-Personal Details']) {
      expect(c(n, 'noreply@fsksurat.in').kind).toBe('machine');
    }
  });
  it('flags the telephony reporter as machine', () => {
    expect(c('Enjay Synapse', 'reports@enjay.test').kind).toBe('machine');
  });
  it('flags transport.support as machine', () => {
    expect(c('', 'transport.support@protego.services').kind).toBe('machine');
  });
  it('flags a Sheets share as machine', () => {
    expect(c('FWGS Accounts (via Google Sheets)', 'x@fwgs.in').kind).toBe('machine');
  });
  it('flags a form notification from a human account by subject', () => {
    expect(c('Hotel Sample', 'hotel.sample@fsksurat.in', 'Local Field Trip filled by - hotel.sample@fsksurat.in').kind).toBe('machine');
  });
  it('flags a body that declares itself generated', () => {
    expect(c('Somebody', 'a@fsksurat.in', 'Bonafide', 'THIS EMAIL IS GENERATED by the portal').kind).toBe('machine');
  });

  it('identifies a parent by address prefix', () => {
    expect(c('', 'p.alpha.sample@fsksurat.in').kind).toBe('parent');
    expect(isParentAddress('p.bravo.sample@fsksurat.in')).toBe(true);
    expect(isParentAddress('foxtrot.sample@fwgs.in')).toBe(false);
  });
  it('identifies a parent by display name even off-domain', () => {
    expect(c('Parents of Some Child', 'someone@gmail.test').kind).toBe('parent');
  });
  // QM-D40 (2026-08-07). Two earlier readings were wrong and both are pinned here:
  //   `s.` was called legacy — it is the CURRENT enrolled-student prefix, and it was classifying
//     as STAFF, so every student mail was filed as a colleague.
  //   `a<year>.` was read as a student joining-year prefix — it is ALUMNI, year = GRADUATION year
  //     (which is what EGS-15 keys cohorts on: "Alumni 2026").
  it('identifies an enrolled student by the s. prefix — NOT as staff', () => {
    expect(c('', 's.echo.sample@fwgs.in').kind).toBe('student');
    expect(c('Echo Sample', 's.echo.sample@fsksurat.in').kind).toBe('student');
    expect(isStudentAddress('s.x@fwgs.in')).toBe(true);
    expect(isStudentAddress('accounts@fwgs.in')).toBe(false);
  });

  it('identifies an alumnus by the a<graduation-year> prefix, and reads the year', () => {
    const v = c('', 'a2026.echo.sample@fwgs.in');
    expect(v.kind).toBe('alumnus');
    expect(v.reason).toContain('2026');
    expect(alumnusGraduationYear('a2019.echo.sample@fwgs.in')).toBe(2019);
    expect(alumnusGraduationYear('s.echo.sample@fwgs.in')).toBeNull();
    // An alumnus is not a student: no enrolment, no guardian, no campus by posting.
    expect(isStudentAddress('a2026.x@fwgs.in')).toBe(false);
  });

  it('gates EVERY prefix test on the school domain', () => {
    // Ungated, this classified as a family, which set senderIsKnownFamily, disabled the
    // vendor-noise filter and started a response clock — on a corpus where ~50% of
    // public-address inbound is solicitation.
    expect(c('', 'p.mehta@somesupplier.test').kind).toBe('external');
    expect(isParentAddress('p.mehta@somesupplier.test')).toBe(false);
    expect(isStudentAddress('s.anyone@anything.test')).toBe(false);
    expect(isAlumnusAddress('a2026.x@anything.test')).toBe(false);
  });
  it('identifies staff on any school or operator domain', () => {
    expect(c('Foxtrot Sample', 'foxtrot.sample@fwgs.in').kind).toBe('staff');
    expect(c('Golf Sample', 'golf.sample@protego.services').kind).toBe('staff');
  });
  it('treats an outside address as external', () => {
    expect(c('A Vendor', 'sales@vendor.test').kind).toBe('external');
  });
  it('always gives a reason', () => {
    for (const v of [c('Student Exit Pass', 'f@x.test'), c('', 'p.a@fsksurat.in'), c('X', 'x@nope.test')]) {
      expect(v.reason.length).toBeGreaterThan(5);
    }
  });
  it('machine beats parent when a parent-looking address sends a generated form', () => {
    // Order matters: the archive has forms sent "as" people.
    expect(c('Parents of X', 'p.x@fsksurat.in', 'Student Exit Pass - New Form filled for X').kind).toBe('machine');
  });
});

describe('rolling-thread detection', () => {
  const machine = (n: number) => Array.from({ length: n }, () => 'machine' as const);
  it('catches the 775-message missed-call report thread', () => {
    expect(isRollingThread({ senderKinds: machine(775), messageCount: 775, spanDays: 900 })).toBe(true);
  });
  it('does not flag a long human argument', () => {
    expect(isRollingThread({
      senderKinds: Array.from({ length: 30 }, () => 'parent' as const),
      messageCount: 30, spanDays: 40,
    })).toBe(false);
  });
  it('does not flag a short automated burst', () => {
    expect(isRollingThread({ senderKinds: machine(5), messageCount: 5, spanDays: 30 })).toBe(false);
  });
  it('does not flag a same-day automated cluster', () => {
    expect(isRollingThread({ senderKinds: machine(40), messageCount: 40, spanDays: 1 })).toBe(false);
  });
});

// ------------------------------------------------------------------ redaction
describe('redaction', () => {
  it('masks email addresses', () => {
    expect(redact('write to p.alpha.sample@fsksurat.in today')).toBe('write to «email» today');
  });
  it('masks Indian mobile numbers in several formats', () => {
    expect(redact('call 9900000001')).toContain('«phone»');
    expect(redact('call +91 9900000001')).toContain('«phone»');
    expect(redact('call 09900000001')).toContain('«phone»');
  });
  it('masks student IDs', () => {
    // Two lengths on purpose: the id pattern allows 4–8 digits. Both sit in the reserved
    // 2099 range enforced by no-real-data.test.ts.
    expect(redact('ref FSK2099001 and FWGS2099')).toBe('ref «student-id» and «student-id»');
  });
  it('masks a "Parents of <child>" construction', () => {
    expect(redact('Parents of Alpha Sample wrote in')).toBe('Parents of «child» wrote in');
  });
  it('masks grade and section tails', () => {
    expect(redactSubject('Student Exit Pass - New Form filled for Charlie Sample (Grade 8 - Zeta) (FSK2099001)'))
      .not.toMatch(/Charlie|Zeta|FSK2099001/);
  });

  it('does NOT mangle title-cased human subjects', () => {
    // These all contain "for <Capitalised words>" but none names a child. Over-masking them
    // destroyed the coordination cluster label in testing.
    expect(redactSubject('Request for Timely Decision-Making During Heavy Rainfall'))
      .toBe('Request for Timely Decision-Making During Heavy Rainfall');
    expect(redactSubject('Correction Request for Attendance')).toBe('Correction Request for Attendance');
    expect(redactSubject('Application for TC')).toBe('Application for TC');
    expect(redactSubject('Request for Dates – Whole School Uniform Photoshoot'))
      .toContain('Whole School Uniform Photoshoot');
  });

  it('still masks the child in a sickbay notification', () => {
    expect(redactSubject('Delta Sample has visited sickbay.')).not.toMatch(/Delta|Sample/);
  });
  it('masks supplied staff names', () => {
    expect(redact('spoke to India Sample', { extraNames: ['India Sample'] })).toBe('spoke to «name»');
  });
  it('masks URLs, which often carry tokens', () => {
    expect(redact('see https://example.test/tok1a2b3 for details')).toBe('see «url» for details');
  });

  it('residualPii finds what redaction missed, and nothing in clean text', () => {
    expect(residualPii('all clean here, «email» only')).toEqual([]);
    expect(residualPii('leaked a@b.test')).toContain('email');
    expect(residualPii('leaked FSK2099001')).toContain('student-id');
  });

  // SYNTHETIC: repeated digits, never a real Aadhaar. The 2-prefix matters — a real Aadhaar
  // never starts 0 or 1, and a 0-prefixed probe passes for the wrong reason (it trips the
  // landline pattern), which is what made this hole look covered.
  it('masks Aadhaar with every separator people type', () => {
    expect(redact('id 2222 2222 2222 attached')).toBe('id «id» attached');
    expect(redact('id 222222222222 attached')).toBe('id «id» attached');
    // The gap: a dash-separated Aadhaar passed redaction untouched until 2026-08-08.
    expect(redact('id 2222-2222-2222 attached')).toBe('id «id» attached');
    expect(redact('id 2222.2222.2222 attached')).toBe('id «id» attached');
  });

  it('residualPii backstops Aadhaar in every format — the gate cannot be blinder than redact', () => {
    // The asymmetry this fixes: redact() masked Aadhaar while the gate scored it clean, so a
    // format redaction missed would have sailed through the one check meant to abort the run.
    for (const leaked of ['2222 2222 2222', '222222222222', '2222-2222-2222', '2222.2222.2222']) {
      expect(residualPii(`ward id ${leaked}`)).toContain('aadhaar');
    }
    // Every class redact() masks must be a class the gate can see.
    expect(residualPii(redact('ward 2222-2222-2222'))).toEqual([]);
  });

  it('does not abort a real report: counts, years and percentages are not Aadhaar', () => {
    // A false positive here costs an eleven-minute re-run over the archive, so the shapes the
    // report actually emits are pinned.
    for (const line of [
      '| 2026 | 22830 |', '| Depth 3–5 | 4672 |', 'Arriving 06:00–09:00: **13.1%** of all',
      '| ID card verification details «n» | 9489 | 0% | 651 | 2022–2026 |',
      '- `xxxxnnnn`', 'kept 93578 of 149182 messages scanned.',
    ]) {
      expect(residualPii(line)).toEqual([]);
    }
  });

  it('is idempotent — redacting twice changes nothing', () => {
    const once = redact('mail p.a.b@fsksurat.in ref FSK2099001 on 9900000001');
    expect(redact(once)).toBe(once);
  });
});
