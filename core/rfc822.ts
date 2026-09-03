// core/rfc822.ts — PURE email parsing. No I/O, no framework imports.
//
// Lives in core/ because two very different callers need it: the offline archive analyser
// (tools/mbox) and live Gmail ingestion (lib/ingest), which fetches `format=raw` precisely so
// there is ONE tested MIME implementation rather than a second one for the API's payload tree.
//
// Handles folded headers, RFC 2047 encoded-words, MIME multipart (recursive, prefers
// text/plain), quoted-printable and base64 transfer encodings, and mboxrd ">From " escaping.

export interface ParsedMessage {
  /** Headers with lower-cased keys; first value wins. */
  headers: Record<string, string>;
  /** All values for repeated headers (Received, etc.). */
  headersAll: Record<string, string[]>;
  /** Best-effort plain-text body, MIME-decoded. */
  text: string;
  /**
   * The text/html part, decoded but NOT tag-stripped; '' when the message has none.
   *
   * Kept alongside `text` because some senders put the CONTENT ONLY in the HTML part: the
   * Enjay Synapse missed-call reports carry their call table as an HTML <table> while their
   * text/plain alternative is prose, so `text` — which prefers text/plain — cannot see a
   * single row (proven against 2,672 real reports, 2026-08-08). A consumer that needs
   * structure rather than prose reads this; everything else keeps reading `text`.
   */
  html: string;
  /**
   * What came ATTACHED to the message — name, type and size, never the bytes.
   *
   * Added for feedback #23: a parent wrote "please find attached" and the desk had nothing to
   * open, twice in one meeting. Deliberately metadata only. Storing the bytes is what produced
   * the 3.7-million-character bodies this same parser was just fixed to stop (#10), and Gmail
   * still holds the original — the Open-in-Gmail link on every record reaches it.
   */
  attachments: Attachment[];
  size: number;
}

export interface Attachment {
  /** The sender's filename when they gave one, else a description of the type. */
  filename: string;
  contentType: string;
  /** Decoded size in bytes, approximated from the encoded length for base64 parts. */
  bytes: number;
}

const decodeQP = (s: string) =>
  s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/**
 * The charset declared on a part's own Content-Type, lowercased. RFC 2045 defaults to
 * us-ascii; we default to utf-8 instead, which is a superset of it and right for modern mail.
 */
const charsetOf = (ctype: string): string =>
  (ctype.match(/charset\s*=\s*"?([^";\r\n]+)"?/i)?.[1] || 'utf-8').trim().toLowerCase();

/**
 * windows-1252's 0x80–0x9F block, which is where it differs from ISO-8859-1: cp1252 puts real
 * punctuation there (0x92 is a right single quote), while 8859-1 leaves unassigned C1 controls.
 * Undefined cp1252 slots (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their own codepoint.
 *
 * Mapped by hand rather than left to TextDecoder because Node disagrees with itself across
 * versions: the deployed container (Node 20.20.2) resolves the 'windows-1252' label to
 * ISO-8859-1 behaviour — byte 0x92 decodes to U+0092 — while Node 24 applies the WHATWG table
 * and yields U+2019. Trusting the runtime would mean the same parent email decoding one way in
 * CI and another way in production, which is precisely the class of bug this file now exists
 * to close. Verified against the live container on 2026-08-25.
 */
const CP1252_C1 = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, // 80-87
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, // 88-8F
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, // 90-97
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178, // 98-9F
];

const isCp1252 = (cs: string) => /^(windows-1252|cp-?1252|x-cp1252|ansi_x3\.110(-1983)?)$/.test(cs);

/**
 * Decode raw part BYTES through a declared charset. TextDecoder handles the real label set
 * (utf-8, iso-8859-*, utf-16, shift_jis…); cp1252 is done explicitly for the reason above.
 * Unknown labels throw RangeError — fall back to UTF-8 rather than losing the text entirely.
 */
const decodeBytes = (buf: Buffer, cs: string): string => {
  if (isCp1252(cs)) {
    let out = '';
    for (const b of buf) out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_C1[b - 0x80] : b);
    return out;
  }
  try { return new TextDecoder(cs).decode(buf); }
  catch { return buf.toString('utf8'); }
};

/**
 * A part's body with content-transfer-encoding AND the declared charset both applied.
 *
 * Both steps are mandatory, and the second was missing until 2026-08-25. Quoted-printable
 * decoding yields BYTES (`=E2=80=99`), which JavaScript then holds as three Latin-1
 * characters; stored straight, a parent's apostrophe became "â€™". 74 of 250 live emails
 * (30%) and 138 messages carried this, worst case 1,693 bad characters in one record.
 * Headers never showed it because decodeHeaderValue always re-decoded through the charset —
 * that asymmetry is what made it read as a mail-provider quirk rather than our own bug. The
 * NUL residue stripNul() guards against has the same root cause.
 *
 * 7bit/8bit parts are deliberately returned untouched: lib/ingest/gmail.ts already decodes
 * the raw RFC822 as UTF-8, so re-decoding here would corrupt what it got right.
 */
const decodePart = (body: string, enc: string, ctype: string): string => {
  const cs = charsetOf(ctype);
  if (enc === 'quoted-printable') return decodeBytes(Buffer.from(decodeQP(body), 'binary'), cs);
  if (enc === 'base64') return decodeBytes(Buffer.from(body.replace(/\s+/g, ''), 'base64'), cs);
  return body;
};

// Postgres text columns categorically reject the NUL byte (distinct from invalid-UTF-8 —
// U+0000 is valid UTF-8, Postgres just refuses to store it). It reaches here when a part's
// real bytes are UTF-16 (or similar) but only content-transfer-encoding is decoded, never the
// declared charset: every other byte of ASCII-range UTF-16 is 0x00, and interpreting those
// bytes as UTF-8/Latin-1 reproduces the NUL literally. Found 2026-08-12: 8 of the first live
// pull's messages failed `prisma.requestMessage.create()` with exactly this Postgres error.
const stripNul = (s: string) => s.split(String.fromCharCode(0)).join('');

/** Decode RFC 2047 encoded-words in a header value ("=?utf-8?B?…?="). */
export function decodeHeaderValue(v: string): string {
  return stripNul(v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    const raw = enc.toUpperCase() === 'B'
      ? Buffer.from(txt, 'base64')
      : Buffer.from(decodeQP(String(txt).replace(/_/g, ' ')), 'binary');
    try { return raw.toString((/utf-?8/i.test(cs) ? 'utf8' : 'latin1') as BufferEncoding); }
    catch { return raw.toString('utf8'); }
  }).replace(/\?=\s*=\?/g, ''));
}

export function parseHeaders(lines: string[]): {
  headers: Record<string, string>; headersAll: Record<string, string[]>; bodyStart: number;
} {
  const headers: Record<string, string> = {};
  const headersAll: Record<string, string[]> = {};
  let i = 0, curKey = '', curVal = '';

  const flush = () => {
    if (!curKey) return;
    const k = curKey.toLowerCase();
    const v = decodeHeaderValue(curVal.trim());
    if (!(k in headers)) headers[k] = v;
    (headersAll[k] ||= []).push(v);
    curKey = ''; curVal = '';
  };

  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === '') { i++; break; }
    if (/^[ \t]/.test(l)) { curVal += ' ' + l.trim(); continue; }
    flush();
    const m = l.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (m) { curKey = m[1]; curVal = m[2]; }
  }
  flush();
  return { headers, headersAll, bodyStart: i };
}

export const stripHtml = (h: string) =>
  h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Is this part something a person reads, or is it a file that came along with the message?
 *
 * The distinction was missing until 2026-08-26 and it was expensive: an `image/png` part's
 * decoded bytes were being treated as body text, so a record's body grew to 3.7 MILLION
 * characters and its page rendered 141,945px tall — unopenable. 141 of 934 live messages were
 * affected. RFC 2045 makes text/plain the default when no Content-Type is given, so an absent
 * header reads as text; an explicit `Content-Disposition: attachment` never does, even on a
 * text/* part, because an attached .txt is still a file rather than the message.
 */
const isReadablePart = (ph: Record<string, string>): boolean => {
  if (/^\s*attachment/i.test(ph['content-disposition'] || '')) return false;
  return /^\s*(text\/|multipart\/)/i.test(ph['content-type'] || 'text/plain');
};

/**
 * Inventory what is attached, walking the same tree extractText walks.
 *
 * A separate pass rather than a second return value from extractText: the two answer different
 * questions, and extractText is recursive — threading an accumulator through it would make the
 * part-skipping logic harder to read than either job deserves.
 */
export function collectAttachments(
  headers: Record<string, string>,
  body: string,
): Attachment[] {
  const ctype = headers['content-type'] || 'text/plain';
  const bMatch = ctype.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  if (!/^multipart\//i.test(ctype) || !bMatch) return [];

  const parts = body.split(
    new RegExp(`^--${bMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*$`, 'm'),
  );

  const out: Attachment[] = [];
  for (const part of parts.slice(1)) {
    const lines = part.replace(/^\r?\n/, '').split(/\r?\n/);
    const ph = parseHeaders(lines);
    const pct = ph.headers['content-type'] || 'text/plain';

    // Recurse into nested multiparts: multipart/mixed wrapping multipart/alternative is the
    // ordinary shape for "a note plus a photo", and the photo hangs off the outer one.
    if (/^\s*multipart\//i.test(pct)) {
      out.push(...collectAttachments(ph.headers, lines.slice(ph.bodyStart).join('\n')));
      continue;
    }
    if (isReadablePart(ph.headers)) continue;

    const raw = lines.slice(ph.bodyStart).join('\n');
    const enc = (ph.headers['content-transfer-encoding'] || '').toLowerCase().trim();
    // base64 carries 4 characters per 3 bytes; anything else is close enough to its own length.
    const encodedLen = raw.replace(/\s+/g, '').length;
    const bytes = enc === 'base64' ? Math.floor((encodedLen * 3) / 4) : raw.length;

    const named =
      (ph.headers['content-disposition'] || '').match(/filename\s*=\s*"?([^";\r\n]+)"?/i)?.[1] ??
      pct.match(/name\s*=\s*"?([^";\r\n]+)"?/i)?.[1] ??
      null;

    out.push({
      filename: (named ?? pct.split(';')[0].trim()).trim(),
      contentType: pct.split(';')[0].trim().toLowerCase(),
      bytes,
    });
  }
  return out;
}


/** Walk a MIME body and return the best plain-text representation. */
export function extractText(headers: Record<string, string>, body: string): string {
  const ctype = headers['content-type'] || 'text/plain';
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase().trim();
  const decode = (s: string) => decodePart(s, enc, ctype);

  const bMatch = ctype.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  if (/^multipart\//i.test(ctype) && bMatch) {
    const boundary = bMatch[1];
    // Non-capturing group is essential: String.split with a capturing group interleaves the
    // captures into the result array, shifting every part by one.
    const parts = body.split(
      new RegExp(`^--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*$`, 'm'),
    );
    const decoded: Array<{ ctype: string; text: string }> = [];
    for (const part of parts.slice(1)) {
      const lines = part.replace(/^\r?\n/, '').split(/\r?\n/);
      const ph = parseHeaders(lines);
      // Skip attachments outright. The last-resort join below used to swallow every part it
      // had collected, so one image was enough to bury the message it came with.
      if (!isReadablePart(ph.headers)) continue;
      const t = extractText(ph.headers, lines.slice(ph.bodyStart).join('\n'));
      if (t.trim()) decoded.push({ ctype: ph.headers['content-type'] || 'text/plain', text: t });
    }
    const plain = decoded.find(d => /text\/plain/i.test(d.ctype));
    if (plain) return plain.text;
    const html = decoded.find(d => /text\/html/i.test(d.ctype));
    if (html) return stripHtml(html.text);
    return decoded.map(d => d.text).join('\n');
  }

  // A non-multipart part that is not text is a FILE — its decoded bytes are a PNG or a PDF, not
  // something anyone reads. Returning them is what produced the 3.7-million-character bodies.
  if (!isReadablePart(headers)) return '';

  const raw = decode(body);
  return /text\/html/i.test(ctype) ? stripHtml(raw) : raw;
}

/**
 * The first text/html part, decoded but left as HTML. Walks multipart exactly as extractText
 * does; returns '' when there is no HTML part. Separate from extractText rather than folded
 * into it because the two answer different questions — "what did this say" versus "what
 * structure did it carry" — and only the second can see a table.
 */
export function extractHtml(headers: Record<string, string>, body: string): string {
  const ctype = headers['content-type'] || 'text/plain';
  const bMatch = ctype.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);

  if (/^multipart\//i.test(ctype) && bMatch) {
    const parts = body.split(
      new RegExp(`^--${bMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*$`, 'm'),
    );
    for (const part of parts.slice(1)) {
      const lines = part.replace(/^\r?\n/, '').split(/\r?\n/);
      const ph = parseHeaders(lines);
      const found = extractHtml(ph.headers, lines.slice(ph.bodyStart).join('\n'));
      if (found.trim()) return found;
    }
    return '';
  }

  // text/html only — and never an ATTACHED .html file, which is a document someone sent, not
  // the message they wrote. Same rule extractText applies.
  if (!/text\/html/i.test(ctype) || !isReadablePart(headers)) return '';
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase().trim();
  return decodePart(body, enc, ctype);
}

/** Turn raw RFC822 lines into a ParsedMessage. */
export function buildMessage(lines: string[]): ParsedMessage {
  // mboxrd escapes body lines beginning "From " as ">From ".
  const unescaped = lines.map(l => l.replace(/^(>+)(From )/, (_, gt, f) => gt.slice(1) + f));
  const { headers, headersAll, bodyStart } = parseHeaders(unescaped);
  const body = unescaped.slice(bodyStart).join('\n');
  return {
    headers, headersAll,
    text: stripNul(extractText(headers, body)),
    html: stripNul(extractHtml(headers, body)),
    attachments: collectAttachments(headers, body),
    size: lines.reduce((n, l) => n + l.length + 1, 0),
  };
}

/** Parse a whole RFC822 message from a single string. */
export const parseRfc822 = (raw: string): ParsedMessage =>
  buildMessage(raw.replace(/\r\n/g, '\n').split('\n'));

// The classic ctime stamp on an mbox separator: "Wed Aug  5 14:37:27 2026".
const CTIME = /\b\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?\s+(19|20)\d{2}\b/;

/**
 * True if a line is an mbox message separator. Deliberately tolerant — exporters vary, and
 * mboxrd escapes body lines starting "From " as ">From ", so a bare one at column 0 is a
 * separator in practice. Still requires something date- or address-like after it.
 */
export const isSeparator = (line: string): boolean => {
  if (!line.startsWith('From ')) return false;
  const rest = line.slice(5).trim();
  if (!rest) return false;
  if (CTIME.test(rest)) return true;
  const first = rest.split(/\s+/)[0] ?? '';
  const senderish = /\S+@\S+/.test(first) || first === 'MAILER-DAEMON' || first === '-';
  return senderish && /\b(19|20)\d{2}\b/.test(rest);
};

function splitAddr(s: string): { name: string; email: string } {
  const t = s.trim();
  const m = t.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].trim().replace(/^"(.*)"$/, '$1').trim(), email: m[2].trim().toLowerCase() };
  }
  return /@/.test(t) ? { name: '', email: t.replace(/[<>]/g, '').toLowerCase() } : { name: t, email: '' };
}

/** Parse an address header into {name, email} pairs, respecting quotes and angle brackets. */
export function parseAddresses(v: string | undefined): Array<{ name: string; email: string }> {
  if (!v) return [];
  const out: Array<{ name: string; email: string }> = [];
  let depth = 0, quoted = false, cur = '';
  for (const ch of v) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') depth++;
    if (!quoted && ch === '>') depth--;
    if (ch === ',' && !quoted && depth <= 0) { out.push(splitAddr(cur)); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(splitAddr(cur));
  return out.filter(a => a.email || a.name);
}
