// core/markdown.ts — markdown parsed into a block model. Pure: string in, blocks out. No I/O,
// no clock, no DOM (the layering rule).
//
// COPIED VERBATIM FROM `recruitment/core/markdown.ts` on 27-Aug-2026, at VK's instruction ("check
// the formatting work done in the recruitment app.. we should probably get that"). The comments
// below are recruitment's and describe ITS corpus of job descriptions; they are kept rather than
// rewritten so the two files stay diffable, which is the only real defence against them drifting.
//
// Why a copy and not a shared module: front-desk VENDORS the design system's CSS instead of
// depending on the package (see the estate CLAUDE.md), so there is no shared library for the two
// apps to import from. A parser is not a `.fh-*` wrapper, so the DS is not the right home either.
// This is a known duplication, deliberately made obvious: if either file changes, diff them.
//
// What front-desk uses it for is DIFFERENT and narrower — turning a reply a desk assistant typed
// into a properly formatted email, instead of the wall of `text/plain` a parent received before.
// See core/email-html.ts, which renders these blocks to email-safe HTML.
//
// WHY THIS EXISTS RATHER THAN A DEPENDENCY. VK's 18-Aug review: the JD registry rendered its
// content as RAW markdown inside a monospace textarea — `**Position/Job title:**` and literal
// bullet characters on screen — which is what "document formatting is something you have not done
// very well" was actually pointing at. Rendering it needs a parser, and the corpus was MEASURED
// before choosing one: across the whole 172 KB HR JD document there are 1,068 bullets, 787 bold
// spans, 564 paragraphs, 323 headings, 43 links, 13 table rows, 6 italics — and **zero HTML tags,
// zero images, zero code spans**. A subset that small and that closed does not justify a
// dependency, and parsing to a block model (never to an HTML string) means no
// `dangerouslySetInnerHTML` and therefore no injection surface at all.
//
// KNOWN AND DELIBERATE LIMITS, all measured against the real corpus:
// · Bullet nesting is ONE level (1,061 bullets at depth 0, 7 at depth 2). Deeper indents collapse
//   to depth 1 rather than erroring.
// · Setext headings (`===`/`---` underlines) are not supported — the corpus has 2, and `---` is
//   ambiguous with a horizontal rule.
// · Inline nesting goes one level deep: link text is re-parsed for emphasis, which covers the 6
//   real `[**bold**](url)` cases. Emphasis wrapping a link is not, because the corpus has none.
// If a future document needs more than this, that is the moment to reconsider a library — not
// before.

export interface MdSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; spans: MdSpan[] }
  | { kind: 'paragraph'; spans: MdSpan[] }
  | { kind: 'list'; items: Array<{ depth: 0 | 1; spans: MdSpan[] }> }
  | { kind: 'table'; header: MdSpan[][]; rows: MdSpan[][][] };

/** Links first so their text is not shredded by the emphasis arms; `**` before `*`, or bold would
 *  parse as two empty italics.
 *
 *  NOT a shared `/g` instance, and that is load-bearing: `parseInline` recurses into link labels,
 *  and a module-level global regex carries `lastIndex` as mutable state — the inner call would
 *  clobber the outer call's scan position mid-loop, which does not merely misparse but can fail to
 *  terminate. Found by the test suite killing its own worker. A fresh instance per call has no
 *  shared state to corrupt. */
/**
 * The link schemes a JD may use. Anything else keeps its text and loses its href.
 *
 * WHY, given nothing was exploitable (adversarial pass, 19-Aug-2026). `app/_Markdown.tsx` renders
 * links through JSX, never `dangerouslySetInnerHTML`, and React 19 blocks `javascript:` hrefs
 * itself — it rewrites them to a throwing stub, verified by rendering one rather than assumed.
 * Browsers separately block top-level navigation to `data:` URLs. So both obvious payloads are
 * already dead.
 *
 * They are dead in the RENDERER and in the BROWSER, though, not here. That is the same shape as the
 * upload allowlist this pass fixed earlier the same day: correct by defence in depth rather than by
 * the parser being right, with nothing stating the dependency. React's behaviour is a version fact,
 * and a block model with a `href` on it is exactly the thing a future consumer might hand to
 * something other than a React `<a>`. An allowlist costs three lines and stops depending on it.
 *
 * Relative and anchor hrefs are allowed — they cannot carry a scheme, and a JD linking to `#duties`
 * or `/apply` is ordinary.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

export function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return null;
  // A scheme is `[a-z][a-z0-9+.-]*:` before any `/`, `?` or `#`. No scheme at all = relative, fine.
  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(v.split(/[/?#]/)[0]);
  if (scheme === null) return v;
  return ALLOWED_SCHEMES.includes(scheme[1].toLowerCase() + ':') ? v : null;
}

const INLINE_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*/;

/** Inline markup → spans. Plain text between matches is preserved verbatim, including whitespace. */
export function parseInline(src: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const inline = new RegExp(INLINE_PATTERN.source, 'g');
  let last = 0;
  const push = (s: MdSpan) => {
    if (s.text) spans.push(s);
  };

  for (let m = inline.exec(src); m !== null; m = inline.exec(src)) {
    push({ text: src.slice(last, m.index) });
    if (m[1] !== undefined) {
      // A link. Re-parse its label so `[**Apply here**](url)` keeps its emphasis; one level only,
      // since a link cannot contain a link. A URL whose scheme is not allowed keeps its TEXT and
      // loses only its href — the reader still sees what was written, and nothing is silently
      // deleted from a JD.
      const href = safeHref(m[2]);
      for (const inner of parseInline(m[1])) push(href === null ? inner : { ...inner, href });
    } else if (m[3] !== undefined) {
      push({ text: m[3], bold: true });
    } else if (m[4] !== undefined) {
      push({ text: m[4], italic: true });
    }
    last = m.index + m[0].length;
  }
  push({ text: src.slice(last) });
  return spans;
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const TABLE_ROW = /^\|(.*)\|\s*$/;
/** `| --- | :--: |` — a table's alignment row carries no content and must not become a data row. */
const TABLE_RULE = /^\|[\s:|-]+\|\s*$/;

const cells = (row: string): MdSpan[][] =>
  row.split('|').map((c) => parseInline(c.trim()));

/**
 * A markdown document → blocks, in source order.
 *
 * Blank lines separate blocks; consecutive bullets form ONE list; consecutive paragraph lines join
 * with a space (markdown's soft-wrap rule — the JD document hard-wraps mid-sentence, so treating
 * each line as its own paragraph would shatter every sentence into fragments).
 */
export function parseMarkdown(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');

  let para: string[] = [];
  let list: Array<{ depth: 0 | 1; spans: MdSpan[] }> | null = null;
  let table: { header: MdSpan[][]; rows: MdSpan[][][] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'paragraph', spans: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ kind: 'list', items: list });
    list = null;
  };
  const flushTable = () => {
    if (table) blocks.push({ kind: 'table', ...table });
    table = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = HEADING.exec(line.trim());
    if (heading) {
      flushAll();
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4,
        spans: parseInline(heading[2]),
      });
      continue;
    }

    if (TABLE_RULE.test(line.trim())) continue; // alignment row — structural, never content
    const tableRow = TABLE_ROW.exec(line.trim());
    if (tableRow) {
      flushPara();
      flushList();
      const row = cells(tableRow[1]);
      if (!table) table = { header: row, rows: [] };
      else table.rows.push(row);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      flushTable();
      list ??= [];
      list.push({ depth: bullet[1].length >= 2 ? 1 : 0, spans: parseInline(bullet[2]) });
      continue;
    }

    // Anything else is prose. A non-bullet line while a list is open ENDS the list rather than
    // being swallowed by it — the JD document uses exactly that shape to close a section.
    flushList();
    flushTable();
    para.push(line.trim());
  }

  flushAll();
  return blocks;
}
