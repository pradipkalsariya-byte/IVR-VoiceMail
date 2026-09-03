import { describe, it, expect } from 'vitest';
import { decodeHeaderValue, parseRfc822 } from '../core/rfc822';

// Regression for the first live Gmail pull (2026-08-12): 8 messages failed
// `prisma.requestMessage.create()` with a Postgres "invalid byte sequence for encoding
// UTF8: 0x00" error. Postgres text columns categorically refuse the NUL byte — and it
// reached the database because content-transfer-encoding is decoded but a part's declared
// CHARSET never is. A part whose real bytes are UTF-16 (ASCII-range characters are
// `<byte> 0x00` pairs) read as UTF-8/Latin-1 reproduces every 0x00 literally.
const NUL = String.fromCharCode(0);

describe('NUL-byte stripping — Postgres cannot store what a misread charset produces', () => {
  it('strips embedded NULs from a base64 body whose real bytes are UTF-16', () => {
    const utf16Body = Buffer.from('Hi there', 'utf16le').toString('base64');
    const raw = [
      'From: Enjay Synapse <reports@synapse.test>',
      'To: frontdesk@fsksurat.in',
      'Subject: test',
      'Content-Type: text/plain; charset="utf-16"',
      'Content-Transfer-Encoding: base64',
      '',
      utf16Body,
    ].join('\r\n');

    const { text } = parseRfc822(raw);
    expect(text).not.toContain(NUL);
    // The bug wasn't "wrong text", it was "text Postgres refuses to store" — confirm the
    // decode still ran (the letters survive) rather than the fix just blanking the field.
    expect(text.replace(/\s/g, '')).toContain('Hi');
  });

  it('strips embedded NULs from the html part the same way', () => {
    const utf16Html = Buffer.from('<p>Hi</p>', 'utf16le').toString('base64');
    const raw = [
      'From: a@b.test', 'To: c@d.test', 'Subject: test',
      'Content-Type: text/html; charset="utf-16"',
      'Content-Transfer-Encoding: base64',
      '', utf16Html,
    ].join('\r\n');

    expect(parseRfc822(raw).html).not.toContain(NUL);
  });

  it('strips embedded NULs from a decoded header value (RFC 2047 encoded-word)', () => {
    const utf16Subject = Buffer.from('Hi', 'utf16le').toString('base64');
    expect(decodeHeaderValue(`=?utf-16?B?${utf16Subject}?=`)).not.toContain(NUL);
  });

  it('leaves an ordinary UTF-8 body completely unaffected', () => {
    const raw = ['From: a@b.test', 'To: c@d.test', 'Subject: normal',
      '', 'Just a plain message, nothing odd here.'].join('\r\n');
    expect(parseRfc822(raw).text).toBe('Just a plain message, nothing odd here.');
  });
});

// Regression for the charset bug found in production on 2026-08-25: 74 of 250 live emails
// (30%) and 138 messages held C1 control characters, because quoted-printable decoding
// produces BYTES and nothing re-decoded them through the part's declared charset. A parent's
// apostrophe (U+2019, bytes E2 80 99) was stored as the three characters U+00E2 U+0080
// U+0099 and rendered "â€™" on the queue. Headers were always fine — decodeHeaderValue has
// re-decoded through the charset since it was written — which is what disguised it.
//
// C1 controls are the load-bearing assertion: U+0080–U+009F are unassigned control
// characters that never occur in real prose, so their presence PROVES a mis-decode, whatever
// the surrounding text happens to look like.
const C1 = new RegExp('[\u0080-\u009f]');
const RSQUO = String.fromCharCode(0x2019); // ’
const EACUTE = String.fromCharCode(0xe9); // é

const mail = (headerLines: string[], body: string) =>
  ['From: a@b.test', 'To: frontdesk@fsksurat.in', 'Subject: test', ...headerLines, '', body]
    .join('\r\n');

describe('declared charset is applied to bodies, not just headers', () => {
  it('decodes a quoted-printable UTF-8 apostrophe to one character, not three', () => {
    const raw = mail(
      ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: quoted-printable'],
      'he doesn=E2=80=99t want to miss it',
    );
    const { text } = parseRfc822(raw);
    expect(text).toBe(`he doesn${RSQUO}t want to miss it`);
    expect(text).not.toMatch(C1);
  });

  it('leaves no C1 controls in a body full of smart punctuation', () => {
    const raw = mail(
      ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'],
      'Dear=20All=E2=80=99=E2=80=9CHello=E2=80=9D=20=E2=80=93=20thanks=C2=A0again',
    );
    expect(parseRfc822(raw).text).not.toMatch(C1);
  });

  it('maps windows-1252 0x80-0x9F to punctuation instead of leaving C1 controls', () => {
    // 0x92 is a right single quote in cp1252 and an unassigned C1 control in iso-8859-1;
    // decoding this range correctly is the whole reason TextDecoder is used here.
    const raw = mail(
      ['Content-Type: text/plain; charset="windows-1252"', 'Content-Transfer-Encoding: quoted-printable'],
      'it=92s here',
    );
    const { text } = parseRfc822(raw);
    expect(text).toBe(`it${RSQUO}s here`);
    expect(text).not.toMatch(C1);
  });

  it('honours iso-8859-1 on a quoted-printable part', () => {
    const raw = mail(
      ['Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable'],
      'caf=E9',
    );
    expect(parseRfc822(raw).text).toBe(`caf${EACUTE}`);
  });

  it('honours a non-UTF-8 charset on a base64 part', () => {
    const body = Buffer.from(`caf${EACUTE}`, 'latin1').toString('base64');
    const raw = mail(
      ['Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: base64'],
      body,
    );
    expect(parseRfc822(raw).text).toBe(`caf${EACUTE}`);
  });

  it('uses each PART own charset inside multipart, not the outer content-type', () => {
    const raw = [
      'From: a@b.test', 'To: c@d.test', 'Subject: test',
      'Content-Type: multipart/alternative; boundary="B1"', '',
      '--B1',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable', '',
      'plain doesn=E2=80=99t break',
      '--B1',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable', '',
      '<p>html doesn=E2=80=99t break</p>',
      '--B1--', '',
    ].join('\r\n');
    const { text, html } = parseRfc822(raw);
    // .trim(): a multipart part legitimately carries the newline before its boundary line.
    expect(text.trim()).toBe(`plain doesn${RSQUO}t break`);
    expect(text).not.toMatch(C1);
    expect(html).toContain(`doesn${RSQUO}t`);
    expect(html).not.toMatch(C1);
  });

  it('does NOT re-decode a plain 8bit body — gmail.ts already read the raw as UTF-8', () => {
    // The failure mode in the other direction: decoding an already-correct string a second
    // time turns a good apostrophe into mojibake. 7bit/8bit parts must pass through untouched.
    const raw = mail(['Content-Type: text/plain; charset="UTF-8"'], `he doesn${RSQUO}t mind`);
    const { text } = parseRfc822(raw);
    expect(text).toBe(`he doesn${RSQUO}t mind`);
    expect(text).not.toMatch(C1);
  });

  it('falls back to UTF-8 rather than losing text on an unknown charset label', () => {
    const raw = mail(
      ['Content-Type: text/plain; charset="x-nonsense-9000"', 'Content-Transfer-Encoding: quoted-printable'],
      'he doesn=E2=80=99t vanish',
    );
    expect(parseRfc822(raw).text).toBe(`he doesn${RSQUO}t vanish`);
  });
});

// The cp1252 table is mapped by hand (Node's TextDecoder resolves 'windows-1252' to
// ISO-8859-1 behaviour on Node 20, the deployed runtime, but to the WHATWG table on Node 24)
// — so the table itself needs pinning, or a typo silently mangles one character forever.
describe('the hand-mapped windows-1252 C1 block', () => {
  const via1252 = (byte: number) => {
    const raw = ['From: a@b.test', 'To: c@d.test', 'Subject: t',
      'Content-Type: text/plain; charset=windows-1252',
      'Content-Transfer-Encoding: quoted-printable', '',
      'x=' + byte.toString(16).toUpperCase().padStart(2, '0') + 'y'].join('\r\n');
    return parseRfc822(raw).text.codePointAt(1);
  };

  // Every assigned slot, from the WHATWG windows-1252 index.
  const EXPECTED: Record<number, number> = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
    0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
    0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
    0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
    0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
  };

  it('maps every assigned 0x80-0x9F byte to the right codepoint', () => {
    for (const [byte, cp] of Object.entries(EXPECTED)) {
      expect({ byte, got: via1252(Number(byte)) }).toEqual({ byte, got: cp });
    }
  });

  it('leaves the five genuinely undefined slots alone', () => {
    for (const byte of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(via1252(byte)).toBe(byte);
  });

  it('passes ASCII and the 0xA0-0xFF range straight through, as cp1252 does', () => {
    expect(via1252(0xe9)).toBe(0xe9); // é, identical in cp1252 and latin-1
    expect(via1252(0xa9)).toBe(0xa9); // ©
  });
});

// Regression for feedback #10 (transcript 00:49:06, "few records contain machine noise").
// extractText walked into EVERY multipart part and treated decoded bytes as body text, so an
// image or PDF attachment landed in the message. Live damage before the fix: 141 of 934
// messages over 20k characters, the worst 3.7 MILLION, and one record's page rendered
// 141,945px tall — effectively unopenable.
describe('attachments are not body text', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const PNG_BYTES = b64('\x89PNG\r\n\x1a\n' + 'BINARYPAYLOAD'.repeat(40));

  const mixed = (extraParts: string[]) => [
    'From: a@b.test', 'To: frontdesk@fsksurat.in', 'Subject: Requesting sick leave',
    'Content-Type: multipart/mixed; boundary="B1"', '',
    '--B1',
    'Content-Type: text/plain; charset=utf-8', '',
    'Good morning maam, Ridhan is unwell today.',
    ...extraParts,
    '--B1--', '',
  ].join('\r\n');

  it('keeps the text and drops an image attachment', () => {
    const raw = mixed([
      '--B1',
      'Content-Type: image/png; name="scan.png"',
      'Content-Disposition: attachment; filename="scan.png"',
      'Content-Transfer-Encoding: base64', '',
      PNG_BYTES,
    ]);
    const { text } = parseRfc822(raw);
    expect(text).toContain('Ridhan is unwell today');
    expect(text).not.toContain('BINARYPAYLOAD');
    expect(text.length).toBeLessThan(500);
  });

  it('drops a PDF attachment even when it is the ONLY non-text part', () => {
    const raw = mixed([
      '--B1',
      'Content-Type: application/pdf; name="policy.pdf"',
      'Content-Transfer-Encoding: base64', '',
      b64('%PDF-1.4 ' + 'PDFPAYLOAD'.repeat(60)),
    ]);
    expect(parseRfc822(raw).text).not.toContain('PDFPAYLOAD');
  });

  it('drops an attachment that has NO content-disposition — type alone is enough', () => {
    // Plenty of senders omit the disposition header; keying only on it would have missed these.
    const raw = mixed([
      '--B1',
      'Content-Type: image/jpeg', 'Content-Transfer-Encoding: base64', '',
      b64('JPEGPAYLOAD'.repeat(50)),
    ]);
    expect(parseRfc822(raw).text).not.toContain('JPEGPAYLOAD');
  });

  it('drops an ATTACHED .txt — a file is a file even when it is text', () => {
    const raw = mixed([
      '--B1',
      'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"', '',
      'ATTACHEDFILECONTENT',
    ]);
    const { text } = parseRfc822(raw);
    expect(text).toContain('Ridhan is unwell today');
    expect(text).not.toContain('ATTACHEDFILECONTENT');
  });

  it('returns empty rather than bytes when the whole message is a single non-text part', () => {
    const raw = ['From: a@b.test', 'To: c@d.test', 'Subject: scan',
      'Content-Type: image/png', 'Content-Transfer-Encoding: base64', '', PNG_BYTES].join('\r\n');
    const { text } = parseRfc822(raw);
    expect(text).not.toContain('BINARYPAYLOAD');
    expect(text.trim()).toBe('');
  });

  it('still reads an inline image alternative correctly — inline is not attachment', () => {
    // Content-Disposition: inline on a text part must keep working.
    const raw = mixed([
      '--B1',
      'Content-Type: text/html; charset=utf-8',
      'Content-Disposition: inline', '',
      '<p>Good morning maam, Ridhan is unwell today.</p>',
    ]);
    expect(parseRfc822(raw).text).toContain('Ridhan is unwell today');
  });

  it('does not let an attached .html masquerade as the message html', () => {
    const raw = mixed([
      '--B1',
      'Content-Type: text/html; name="report.html"',
      'Content-Disposition: attachment; filename="report.html"', '',
      '<p>ATTACHEDREPORT</p>',
    ]);
    expect(parseRfc822(raw).html).not.toContain('ATTACHEDREPORT');
  });

  it('keeps the Synapse missed-call HTML table working — the structure path must not regress', () => {
    // tools/mbox depends on extractHtml seeing the report table; it is text/html and inline.
    const raw = [
      'From: reports@synapse.test', 'To: frontdesk@fsksurat.in', 'Subject: Daily Misscall Report',
      'Content-Type: multipart/alternative; boundary="B2"', '',
      '--B2', 'Content-Type: text/plain', '', 'See the table.',
      '--B2', 'Content-Type: text/html', '', '<table><tr><td>09:41</td><td>9900000123</td></tr></table>',
      '--B2--', '',
    ].join('\r\n');
    expect(parseRfc822(raw).html).toContain('9900000123');
  });
});

// Feedback #23a: "please find attached" with nothing to open, twice in one meeting. The parser
// already skips attachment parts (#10); it now also says what they were.
describe('attachment inventory', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  const withParts = (extra: string[]) => [
    'From: a@b.test', 'To: frontdesk@fsksurat.in', 'Subject: Please find attached',
    'Content-Type: multipart/mixed; boundary="B1"', '',
    '--B1', 'Content-Type: text/plain', '', 'Please find attached the form.',
    ...extra, '--B1--', '',
  ].join('\r\n');

  it('names an attachment from its content-disposition filename', () => {
    const raw = withParts([
      '--B1',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="Exit Pass.pdf"',
      'Content-Transfer-Encoding: base64', '', b64('x'.repeat(900)),
    ]);
    const { attachments, text } = parseRfc822(raw);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('Exit Pass.pdf');
    expect(attachments[0].contentType).toBe('application/pdf');
    expect(attachments[0].bytes).toBeGreaterThan(800);
    // …and the body is still just the note.
    expect(text).toContain('Please find attached the form');
  });

  it('falls back to the content-type name parameter', () => {
    const raw = withParts([
      '--B1', 'Content-Type: image/jpeg; name="scan.jpg"',
      'Content-Transfer-Encoding: base64', '', b64('y'.repeat(400)),
    ]);
    expect(parseRfc822(raw).attachments[0].filename).toBe('scan.jpg');
  });

  it('describes an unnamed attachment by its type rather than inventing a name', () => {
    const raw = withParts([
      '--B1', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', '', b64('z'.repeat(200)),
    ]);
    const a = parseRfc822(raw).attachments[0];
    expect(a.filename).toBe('image/png');
    expect(a.contentType).toBe('image/png');
  });

  it('finds attachments nested inside a multipart/alternative wrapper', () => {
    // multipart/mixed wrapping multipart/alternative is the ordinary "note plus photo" shape.
    const raw = [
      'From: a@b.test', 'To: c@d.test', 'Subject: nested',
      'Content-Type: multipart/mixed; boundary="OUT"', '',
      '--OUT', 'Content-Type: multipart/alternative; boundary="IN"', '',
      '--IN', 'Content-Type: text/plain', '', 'Note.',
      '--IN', 'Content-Type: image/gif; name="inner.gif"',
      'Content-Transfer-Encoding: base64', '', b64('g'.repeat(100)),
      '--IN--',
      '--OUT', 'Content-Type: application/pdf; name="outer.pdf"',
      'Content-Transfer-Encoding: base64', '', b64('p'.repeat(100)),
      '--OUT--', '',
    ].join('\r\n');
    const names = parseRfc822(raw).attachments.map(a => a.filename).sort();
    expect(names).toEqual(['inner.gif', 'outer.pdf']);
  });

  it('does NOT list the readable body parts as attachments', () => {
    const raw = [
      'From: a@b.test', 'To: c@d.test', 'Subject: alt',
      'Content-Type: multipart/alternative; boundary="B2"', '',
      '--B2', 'Content-Type: text/plain', '', 'plain',
      '--B2', 'Content-Type: text/html', '', '<p>html</p>',
      '--B2--', '',
    ].join('\r\n');
    expect(parseRfc822(raw).attachments).toEqual([]);
  });

  it('DOES list an attached text file — a file is a file even when it is text', () => {
    const raw = withParts([
      '--B1', 'Content-Type: text/plain; name="notes.txt"',
      'Content-Disposition: attachment; filename="notes.txt"', '', 'file content',
    ]);
    expect(parseRfc822(raw).attachments.map(a => a.filename)).toEqual(['notes.txt']);
  });

  it('returns an empty list for a message with no multipart at all', () => {
    const raw = ['From: a@b.test', 'To: c@d.test', 'Subject: plain', '', 'Just text.'].join('\r\n');
    expect(parseRfc822(raw).attachments).toEqual([]);
  });

  it('stores metadata only — never the bytes', () => {
    const raw = withParts([
      '--B1', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', '',
      b64('SECRETPAYLOAD'.repeat(50)),
    ]);
    const json = JSON.stringify(parseRfc822(raw).attachments);
    expect(json).not.toContain('SECRETPAYLOAD');
    expect(json).not.toMatch(/[A-Za-z0-9+/]{100,}/);
  });
});
