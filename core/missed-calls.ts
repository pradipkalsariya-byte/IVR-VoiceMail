// core/missed-calls.ts — parse an Enjay Synapse missed-call report. PURE.
//
// Why this exists (QM-D14 consequence 1): the desk currently does a MANUAL HALF-HOURLY check
// of the Enjay Synapse missed-call report mails — the telephony system mails a summary of
// calls the switchboard did not answer, and a person reads it and rings people back. The live
// archive's canonical example is the "frontdesk missed call report" rolling thread: 775
// messages, one thread, years. Exploding each report into per-call capture records replaces
// that manual check with the same triage the desk already does for every other capture.
//
// FORMAT VALIDATED 2026-08-08 against 2,672 real reports in the Takeout archive (2022, 2025
// and 2026 — the vendor's layout has not drifted in five years). The earlier version of this
// file guessed at a pipe-separated text layout and was wrong in every particular:
//
//   * The report is an HTML <table> inside a multipart/alternative mail. The text/plain
//     alternative carries prose only, so a parser reading `body` sees NO rows at all —
//     1,492 of 1,502 sampled reports contained not one pipe-separated line. Read the HTML.
//   * There are TWO layouts, both current, distinguished by their header labels. Columns are
//     therefore matched BY LABEL, never by position: the caller is column 0 in one and column
//     1 in the other, and the guessed layout had it in column 1 of both.
//   * Times are full `YYYY-MM-DD HH:MM:SS` datetimes in IST, 24-hour, dash-separated
//     (37,964 cells, no exceptions) — not the bare `HH:MM` the old code required. Each row
//     therefore carries its own date, which retires the old rowInstant() guess that every row
//     shared the report's date and would mis-date a report spanning midnight.
//   * There is NO campus or line column in either layout. `Destination` (the dialled line —
//     a 4-digit extension in 2,790 rows) is the only campus proxy the report offers.
//   * The 'callback' layout carries `Callback Status`, so the VENDOR ALREADY KNOWS whether a
//     call was returned. Across 17,055 rows only 1,612 read "Callback Done" — the desk's
//     manual check is closing under 10% of missed calls, which is the whole argument for
//     this feature. Rows already returned must not become work: see explodeMissedCallReport.
//
// The old failure mode is the one worth remembering: with no pipes in the body the parser
// returned zero entries AND zero skips, because non-row lines were skipped before the counter
// — so the "rising skip count" canary this file was built around could never fire. Hence
// `format`: a caller can now tell "a report with no missed calls" from "I could not read
// this at all", and lib/ingest/run.ts records the second as an error.

import { normalisePhone } from './phone';

/** Which of the vendor's two layouts a report used. */
export type MissedCallFormat =
  /** `Source | Destination | Misscall Time | Callback Status | Callback Time` */
  | 'callback'
  /** `Call Date | Source | Destination | Disposition | Type | Duration` */
  | 'calllog'
  /** No table, or a table whose header matches neither layout — never a silent zero. */
  | 'unrecognised';

/** One missed call, as reported. */
export interface MissedCallEntry {
  /**
   * 1-based position among the report's data rows (header excluded, malformed rows still
   * counted) — the visual row a desk member would point at, and the stable index the derived
   * sourceMessageId is built from.
   */
  row: number;
  /** When the call came in. Parsed from the row's own IST datetime. */
  at: Date;
  /** Last 10 digits of the caller number, normalised — the same key Family.phoneKey uses. */
  callerPhone: string;
  /** The dialled line/extension, lowercased, when the report names one. A campus HINT only. */
  destination?: string;
  /**
   * True when the vendor's own record says this call was already returned. Always false in
   * the 'calllog' layout, which has no callback column — false means "not known to be
   * returned", never "confirmed outstanding".
   */
  callbackDone: boolean;
  /** When the callback happened, when the report says so. */
  callbackAt?: Date;
}

export interface MissedCallParse {
  /** Which layout was read. 'unrecognised' means the input could not be parsed AT ALL. */
  format: MissedCallFormat;
  entries: MissedCallEntry[];
  /**
   * Rows that had the table's shape but failed validation. Surfaced rather than swallowed: a
   * rising skip count is the first sign the vendor changed something. The vendor's own
   * "No Missed Calls." / "No Records Found" placeholder row is NOT a malformed row and is
   * never counted here — an empty report is a normal event, several hundred times a year.
   */
  skipped: number;
}

const IST_OFFSET_MIN = 330;
const MIN = 60_000;

/** The vendor's placeholder for a period with nothing to report. */
const EMPTY_MARKER = /^(no missed calls|no records found)\b/i;

const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * `YYYY-MM-DD HH:MM:SS` in IST → an instant. Returns null on anything else, which is what
 * feeds `skipped`. The vendor emits no timezone and no offset: the switchboard is in Surat,
 * so the wall clock is IST by construction (validated: 37,964 of 37,964 cells, 24-hour).
 */
export function parseIstDateTime(value: string): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcish = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  if (!Number.isFinite(utcish)) return null;
  const at = new Date(utcish - IST_OFFSET_MIN * MIN);
  // Reject a rolled-over date ("2026-02-31") rather than silently accepting the shift.
  const back = new Date(+at + IST_OFFSET_MIN * MIN);
  return back.getUTCMonth() === +mo - 1 && back.getUTCDate() === +d ? at : null;
}

/** Cell text from one HTML table cell: tags out, entities in, whitespace collapsed. */
const cellText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The report table's rows as cell text. A mail template wraps its content in layout tables,
 * so the table with the most rows is the report — the same rule the archive probe used, and
 * it picked the right table in all 2,676 sampled reports (single-table mails, in fact).
 */
function tableRows(html: string): string[][] {
  let best: string[][] = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(tr =>
      [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => cellText(c[1])),
    );
    if (rows.length > best.length) best = rows;
  }
  return best;
}

/** Column indices for the fields we need, resolved BY LABEL from the header row. */
interface Layout {
  format: Exclude<MissedCallFormat, 'unrecognised'>;
  caller: number;
  at: number;
  destination: number;
  callbackStatus: number;
  callbackAt: number;
}

function readLayout(header: string[]): Layout | null {
  const idx = new Map(header.map((h, i) => [normLabel(h), i]));
  const at = (label: string) => idx.get(label) ?? -1;

  if (idx.has('source') && idx.has('misscall time')) {
    return {
      format: 'callback',
      caller: at('source'), at: at('misscall time'), destination: at('destination'),
      callbackStatus: at('callback status'), callbackAt: at('callback time'),
    };
  }
  if (idx.has('source') && idx.has('call date')) {
    return {
      format: 'calllog',
      caller: at('source'), at: at('call date'), destination: at('destination'),
      callbackStatus: -1, callbackAt: -1,
    };
  }
  return null;
}

/**
 * Parse a report. Deterministic: the same HTML always yields the same entries.
 *
 * Takes the message's HTML part (ParsedMessage.html / IncomingMessage.bodyHtml). A plain-text
 * body is accepted too and simply finds no table — which now reports 'unrecognised' rather
 * than an indistinguishable empty success.
 */
export function parseMissedCallReport(html: string): MissedCallParse {
  const rows = tableRows(html ?? '');
  if (rows.length < 1) return { format: 'unrecognised', entries: [], skipped: 0 };

  const headerIdx = rows.findIndex(r => readLayout(r) !== null);
  if (headerIdx < 0) return { format: 'unrecognised', entries: [], skipped: 0 };
  const layout = readLayout(rows[headerIdx])!;

  const entries: MissedCallEntry[] = [];
  let skipped = 0;
  let row = 0;

  for (const cells of rows.slice(headerIdx + 1)) {
    // The vendor's empty-period placeholder spans the table as one prose cell. It is a normal
    // report, not a malformed row, and must not inflate the canary.
    if (cells.every(c => !c) || cells.some(c => EMPTY_MARKER.test(c))) continue;

    row += 1;
    const at = parseIstDateTime(cells[layout.at] ?? '');
    const callerPhone = normalisePhone(cells[layout.caller] ?? '');
    if (!at || !callerPhone) { skipped += 1; continue; }

    const status = layout.callbackStatus >= 0 ? normLabel(cells[layout.callbackStatus] ?? '') : '';
    const callbackAt = layout.callbackAt >= 0
      ? parseIstDateTime(cells[layout.callbackAt] ?? '')
      : null;

    entries.push({
      row,
      at,
      callerPhone,
      destination: (cells[layout.destination] ?? '').toLowerCase().trim() || undefined,
      callbackDone: status === 'callback done',
      ...(callbackAt ? { callbackAt } : {}),
    });
  }

  return { format: layout.format, entries, skipped };
}

/**
 * Is this mail a missed-call report worth exploding? The MACHINE_NAME list in core/senders.ts
 * already recognises the sender and parks the report mail itself; this narrows to the one
 * report type that spawns capture records — Enjay Synapse mails other summaries too, and none
 * of those are calls the desk owes anyone.
 *
 * The exact-display-name gate was VALIDATED against the archive (2026-08-08): "Enjay Synapse"
 * on 1,491 of 1,502 matching mails. The other 11 are human forwards of a report, which carry
 * no fresh calls and should not explode — so the strictness is correct, not incidental.
 *
 * The SUBJECT half was wrong, and running the rewritten parser over the archive is what found
 * it: the vendor uses two spellings, "Missed Call Report" and "Misscall Report", and the old
 * `/missed[\s-]?call/` matched only the first. That silently excluded the entire 'callback'
 * layout — 808 of 1,500 reports, and precisely the ones carrying Callback Status. Recognition
 * accepts both spellings; a validation pass that only confirms what you assumed is not one.
 */
export function isMissedCallReport(msg: { from: { name: string }; subject: string }): boolean {
  return /^Enjay Synapse$/i.test(msg.from.name.trim())
    && /miss(?:ed[\s-]?)?call/i.test(msg.subject);
}

/**
 * The derived per-call idempotency key: the call's own phone + instant, NOT the containing
 * report's Message-ID or row position.
 *
 * BUG (found 2026-08-12, first live pull): the report is CUMULATIVE — the vendor re-lists
 * every still-outstanding call in EVERY subsequent half-hourly report until someone calls
 * back (documented above: under 10% ever carry "Callback Done"). Keying on the report's own
 * Message-ID meant the SAME missed call, re-listed across N report cycles, derived N DIFFERENT
 * ids — one per report — and exploded into N duplicate Request rows. On the first real pull
 * this was 149 of 334 rows (44% of the database) for just 46 actual calls, and because every
 * duplicate shared the identical subject, it also false-positived core/coordination.ts's
 * template detector into "Looks coordinated" for a single unresolved call, not a burst of
 * families. Keying on the call itself fixes both: the second and later reports' rows now
 * resolve to the SAME id as the first, so lib/ingest/run.ts's `have.has(sourceMessageId)`
 * check correctly treats them as already-captured and creates nothing.
 */
export function missedCallRowMessageId(callerPhone: string, at: Date): string {
  return `missed-call-${callerPhone}-${at.toISOString()}`;
}

/** 'HH:MM' IST of an instant — how the desk names a report ("the 10:30 report"). */
export function istClockLabel(at: Date): string {
  const local = new Date(+at + IST_OFFSET_MIN * MIN);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}
