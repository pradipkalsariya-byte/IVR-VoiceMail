// core/email-html.ts — a reply the desk typed, turned into an email a parent can read.
//
// VK, 27-Aug-2026: "for the replies on email directly — check the formatting work done in the
// recruitment app.. we should probably get that". What prompted it: every reply this app has ever
// sent went out as `Content-Type: text/plain; charset=UTF-8` — one unbroken wall of text, with no
// paragraphs, no emphasis and no lists, and with line breaks that several clients reflow away
// entirely. The desk writes something structured and the family receives something that is not.
//
// So a reply now leaves as `multipart/alternative`: the text the assistant typed as the plain
// part, and this module's HTML as the rich part. Every client picks the one it can render, and
// nothing is lost for the ones that cannot.
//
// SAFETY — why there is no sanitiser here and none is needed. This never parses HTML and never
// passes a string through. It walks core/markdown.ts's BLOCK MODEL and emits tags itself, escaping
// every text node on the way out; the only attribute it ever writes is an href that already
// survived `safeHref`'s scheme allowlist. A desk assistant who types `<script>` gets the literal
// characters `<script>` in their reply, because that is what they typed.
//
// EMAIL-SPECIFIC CONSTRAINTS, which is why this is not just a React renderer:
//   · Styles must be INLINE. Gmail strips <style> blocks, so a class-based approach renders as
//     unstyled text in the client most of these families actually use.
//   · No external stylesheet, no font import, no image. A reply from a school should render the
//     same on a ten-year-old Android mail client as in a browser.
//   · Margins on <p> rather than <br><br>: clients disagree about collapsing the latter.
//
// PURE. String in, string out.

import { parseMarkdown, type MdBlock, type MdSpan } from './markdown';

/** The five characters that can change the meaning of markup. Everything else passes through. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Deliberately plain. This is correspondence from a school office, not a campaign — the job is to
// be legible on any client, not to be branded. A system font stack means nothing to download.
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
const P = `margin:0 0 14px 0;${FONT};font-size:15px;line-height:1.55;color:#1a1a17`;
const LI = `margin:0 0 6px 0;${FONT};font-size:15px;line-height:1.55;color:#1a1a17`;
const H = (size: number) =>
  `margin:0 0 10px 0;${FONT};font-size:${size}px;line-height:1.3;color:#1a1a17;font-weight:600`;

function renderSpans(spans: readonly MdSpan[]): string {
  return spans.map(s => {
    let out = escapeHtml(s.text);
    if (s.bold) out = `<strong>${out}</strong>`;
    if (s.italic) out = `<em>${out}</em>`;
    // `href` has already been through safeHref(); escaping it again is belt-and-braces against a
    // quote breaking out of the attribute.
    if (s.href) out = `<a href="${escapeHtml(s.href)}" style="color:#1d4ed8">${out}</a>`;
    return out;
  }).join('');
}

function renderBlock(b: MdBlock): string {
  switch (b.kind) {
    case 'heading':
      return `<h${b.level} style="${H([0, 20, 18, 16, 15][b.level])}">${renderSpans(b.spans)}</h${b.level}>`;
    case 'paragraph':
      return `<p style="${P}">${renderSpans(b.spans)}</p>`;
    case 'list': {
      // One level of nesting, matching the parser's own documented limit. A nested item opens a
      // sub-list rather than being flattened, so an indented point still reads as subordinate.
      const items: string[] = [];
      let inNested = false;
      for (const it of b.items) {
        if (it.depth === 1 && !inNested) { items.push('<ul style="margin:0 0 6px 0;padding-left:22px">'); inNested = true; }
        if (it.depth === 0 && inNested) { items.push('</ul>'); inNested = false; }
        items.push(`<li style="${LI}">${renderSpans(it.spans)}</li>`);
      }
      if (inNested) items.push('</ul>');
      return `<ul style="margin:0 0 14px 0;padding-left:22px">${items.join('')}</ul>`;
    }
    case 'table': {
      const cell = `padding:6px 10px;border:1px solid #d8d4c8;${FONT};font-size:14px;color:#1a1a17`;
      const head = b.header.map(h => `<th style="${cell};text-align:left;background:#f5f3ee">${renderSpans(h)}</th>`).join('');
      const rows = b.rows.map(r =>
        `<tr>${r.map(c => `<td style="${cell}">${renderSpans(c)}</td>`).join('')}</tr>`).join('');
      return `<table style="border-collapse:collapse;margin:0 0 14px 0">`
        + `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  }
}

/** The HTML part of the reply. A fragment wrapped in one container — no <html>, no <head>. */
export function renderEmailHtml(markdown: string): string {
  const blocks = parseMarkdown(markdown ?? '');
  const body = blocks.map(renderBlock).join('');
  return `<div style="${FONT};font-size:15px;line-height:1.55;color:#1a1a17">${body}</div>`;
}

/**
 * The plain-text part.
 *
 * NOT the raw markdown: a client showing the plain part should not be showing `**bold**` and
 * `- ` bullet syntax to a parent. Emphasis markers are dropped, bullets become "· ", and a link
 * keeps its text with the URL in brackets after it — which is what a reader of a text-only client
 * actually needs.
 */
/** Newline handling for the plain part, kept as named constants so the escapes are
 *  written once and read plainly. */
const NL = String.fromCharCode(10);
const BLANK_RUN = new RegExp(NL + '{3,}', 'g');
const LEADING_BLANKS = new RegExp('^' + NL + '+');
const TRAILING_SPACE = new RegExp('[ ' + String.fromCharCode(9) + NL + ']+$');

export function renderEmailText(markdown: string): string {
  const spansToText = (spans: readonly MdSpan[]) =>
    spans.map(s => (s.href ? `${s.text} (${s.href})` : s.text)).join('');

  const out: string[] = [];
  for (const b of parseMarkdown(markdown ?? '')) {
    switch (b.kind) {
      case 'heading':
      case 'paragraph':
        out.push(spansToText(b.spans));
        break;
      case 'list':
        for (const it of b.items) out.push(`${it.depth === 1 ? '    ' : '  '}\u00b7 ${spansToText(it.spans)}`);
        break;
      case 'table':
        out.push(b.header.map(spansToText).join(' | '));
        for (const r of b.rows) out.push(r.map(spansToText).join(' | '));
        break;
    }
    out.push('');
  }
  // Trims blank LINES, not whitespace. A bare .trim() ate the leading indent off the FIRST
  // bullet and no other, so a two-item list arrived with its first item hanging to the left.
  return out.join(NL)
    .replace(BLANK_RUN, NL + NL)
    .replace(LEADING_BLANKS, '')
    .replace(TRAILING_SPACE, '');
}

/**
 * The whole RFC822 reply, assembled.
 *
 * Lives in core/ rather than in the Gmail client so it can be TESTED without a network: the MIME
 * envelope is the part a parent's client actually parses, and "did the send call succeed" says
 * nothing about whether the message was well-formed.
 *
 * Deterministic — the boundary is derived from the id being replied to, never randomised. core/
 * forbids a clock or Math.random, and a stable boundary is equally valid MIME; it only has to not
 * occur inside the body, which a hex token cannot.
 */
export function buildReplyMime(args: {
  fromAlias: string;
  to: string[];
  cc?: string[];
  subject: string;
  inReplyToMessageId: string;
  /** What the desk typed, in markdown. */
  body: string;
}): string {
  const boundary = `=_fd_${Buffer.from(args.inReplyToMessageId).toString('hex').slice(0, 24)}`;
  const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

  return [
    `From: ${args.fromAlias}`,
    `To: ${args.to.join(', ')}`,
    ...(args.cc?.length ? [`Cc: ${args.cc.join(', ')}`] : []),
    `Subject: ${args.subject.startsWith('Re:') ? args.subject : `Re: ${args.subject}`}`,
    `In-Reply-To: ${args.inReplyToMessageId}`,
    `References: ${args.inReplyToMessageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    // Least-rich part FIRST. RFC 2046 says a client takes the LAST part it understands, so
    // plain-before-html is precisely what makes a modern client show the formatted one. Reversed,
    // every recipient would silently get the plain version and the whole change would do nothing.
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    renderEmailText(args.body),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    renderEmailHtml(args.body),
    '',
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

/**
 * A brand-new email — no thread to reply to, so no `In-Reply-To`/`References` and no forced
 * "Re:" prefix (buildReplyMime is deliberately reply-only; this is its standalone sibling).
 * First use: notifying a team mailbox about a captured IVR voicemail (core/voicemail.ts).
 *
 * Still deterministic: `boundarySeed` plays the role `inReplyToMessageId` plays above — some
 * value unique to THIS message (a voicemail's own sourceMessageId is exactly that) — so the
 * MIME boundary is stable without a clock or Math.random, and core stays pure.
 */
export function buildNewMime(args: {
  fromAlias: string;
  to: string[];
  cc?: string[];
  subject: string;
  boundarySeed: string;
  /** What the system generated, in markdown. */
  body: string;
}): string {
  const boundary = `=_fd_${Buffer.from(args.boundarySeed).toString('hex').slice(0, 24)}`;
  const CRLF = String.fromCharCode(13) + String.fromCharCode(10);

  return [
    `From: ${args.fromAlias}`,
    `To: ${args.to.join(', ')}`,
    ...(args.cc?.length ? [`Cc: ${args.cc.join(', ')}`] : []),
    `Subject: ${args.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    renderEmailText(args.body),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    renderEmailHtml(args.body),
    '',
    `--${boundary}--`,
    '',
  ].join(CRLF);
}
