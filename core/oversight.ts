// core/oversight.ts — the two questions the oversight page should answer.
//
// Feedback #30, 26-Aug-2026. VK, walking past the page: "Overall analytics. I don't think
// anything is happening here. It's just to show what all are the different ways of analyzing
// this oversight." In triage he ruled it a REQUEST, not an observation, and asked for both
// halves on one page:
//
//   1. WHERE IS THE SYSTEM FAILING — what is late, what is ageing, what nobody owns.
//   2. WHAT ARE FAMILIES ACTUALLY ASKING ABOUT — which topics, and which are growing.
//
// The second is the one the page never had, and it is the one that answers "what should the
// school fix at source" rather than "how busy was the desk".
//
// The locked constraint holds throughout: NOBODY IS SCORED. Every function here aggregates
// requests, never people. There is deliberately no per-owner breakdown, and adding one would
// cross QM-D16(c)'s firewall.
//
// PURE — no database, no clock of its own. `now` is always passed in, so the same inputs give
// the same numbers in a test as on the page.

export interface OversightRow {
  category: string | null;
  suggestedCategory: string | null;
  status: string;
  ownerId?: string | null;
  arrivedAt: Date;
  slaDueAt?: Date | null;
  firstReplyAt?: Date | null;
  resolvedAt?: Date | null;
}

const DAY = 86_400_000;

/** The filed category, falling back to the suggestion — same rule the filters use. */
const categoryOf = (r: OversightRow): string | null => r.category ?? r.suggestedCategory ?? null;

const isWorking = (r: OversightRow) => r.status === 'open' || r.status === 'waiting';

// ─────────────────────────────────────────────── 1 · where the system is failing

export interface AgeingBucket {
  key: string;
  label: string;
  /** Open items whose age falls in this band. */
  count: number;
}

/**
 * How long open work has been waiting, in bands.
 *
 * Ageing rather than a single "overdue" count, because the two say different things: overdue
 * is a target missed, ageing is how badly and for how long. A desk with four items one day
 * late is in a different position from one with four items a fortnight late, and the current
 * page could not tell those apart.
 *
 * Measured from ARRIVAL, not from the response clock: the desk-hours grace is the school's
 * concession to itself and is not what the family experienced waiting.
 */
export function ageingBuckets(rows: readonly OversightRow[], now: Date): AgeingBucket[] {
  const bands: Array<{ key: string; label: string; maxDays: number }> = [
    { key: 'today', label: 'Today', maxDays: 1 },
    { key: 'days', label: '1–3 days', maxDays: 3 },
    { key: 'week', label: '3–7 days', maxDays: 7 },
    { key: 'fortnight', label: '1–2 weeks', maxDays: 14 },
    { key: 'older', label: 'Over 2 weeks', maxDays: Infinity },
  ];
  const out = bands.map(b => ({ key: b.key, label: b.label, count: 0 }));
  for (const r of rows) {
    if (!isWorking(r)) continue;
    const ageDays = (now.getTime() - r.arrivedAt.getTime()) / DAY;
    const i = bands.findIndex(b => ageDays < b.maxDays);
    out[i === -1 ? bands.length - 1 : i].count += 1;
  }
  return out;
}

export interface HealthSummary {
  open: number;
  unowned: number;
  breached: number;
  /** Filed, but the family has heard nothing back yet. */
  awaitingFirstReply: number;
  /** The oldest open item's age in whole days, or null when nothing is open. */
  oldestOpenDays: number | null;
}

export function healthSummary(rows: readonly OversightRow[], now: Date): HealthSummary {
  const open = rows.filter(isWorking);
  const ages = open.map(r => Math.floor((now.getTime() - r.arrivedAt.getTime()) / DAY));
  return {
    open: open.length,
    unowned: open.filter(r => !r.ownerId).length,
    breached: open.filter(r => r.slaDueAt && !r.firstReplyAt && r.slaDueAt.getTime() < now.getTime()).length,
    awaitingFirstReply: open.filter(r => !r.firstReplyAt).length,
    // null, not 0: "nothing is open" and "the oldest is under a day" are different states, and
    // a zero would read as the second when it meant the first.
    oldestOpenDays: ages.length ? Math.max(...ages) : null,
  };
}

// ─────────────────────────────────────────────── 2 · what families are asking about

export interface DemandRow {
  category: string;
  /** Requests in the most recent window. */
  current: number;
  /** Requests in the window before it. */
  previous: number;
  /**
   * Change as a proportion of the previous window: 0.5 means half as many again.
   * NULL when the previous window was empty — a rise from nothing has no percentage, and
   * printing "+100%" or "+∞" there would be inventing a number the data cannot support.
   */
  change: number | null;
}

/**
 * Category volumes over two equal windows, so the page can say what is GROWING rather than
 * only what is big. "Transport is our largest category" is not actionable on its own; "fees
 * doubled this fortnight" is.
 */
export function demandByCategory(
  rows: readonly OversightRow[],
  now: Date,
  windowDays = 14,
): DemandRow[] {
  const currentStart = now.getTime() - windowDays * DAY;
  const previousStart = now.getTime() - 2 * windowDays * DAY;

  const tally = new Map<string, { current: number; previous: number }>();
  for (const r of rows) {
    const cat = categoryOf(r);
    if (!cat) continue;
    const t = r.arrivedAt.getTime();
    const bucket = tally.get(cat) ?? { current: 0, previous: 0 };
    if (t >= currentStart) bucket.current += 1;
    else if (t >= previousStart) bucket.previous += 1;
    else continue;
    tally.set(cat, bucket);
  }

  return [...tally.entries()]
    .map(([category, t]) => ({
      category,
      current: t.current,
      previous: t.previous,
      change: t.previous === 0 ? null : (t.current - t.previous) / t.previous,
    }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous);
}

/**
 * The categories worth a conversation: meaningfully up, and on enough volume to mean something.
 *
 * The floor matters. Two requests becoming four is a 100% rise and almost certainly noise; the
 * page would cry wolf every fortnight without it.
 */
export function growing(
  demand: readonly DemandRow[],
  { minCurrent = 4, minChange = 0.5 }: { minCurrent?: number; minChange?: number } = {},
): DemandRow[] {
  return demand
    .filter(d => d.current >= minCurrent && d.change !== null && d.change >= minChange)
    .sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
}

/**
 * Median days from arrival to resolution, over items resolved in the window.
 *
 * Median rather than mean: one request that sat for six months would drag an average into
 * uselessness, and the desk wants the typical experience, not the arithmetic one.
 * Null when nothing resolved in the window — see the oldestOpenDays note.
 */
export function medianResolutionDays(
  rows: readonly OversightRow[],
  now: Date,
  windowDays = 30,
): number | null {
  const since = now.getTime() - windowDays * DAY;
  const spans = rows
    .filter(r => r.resolvedAt && r.resolvedAt.getTime() >= since)
    .map(r => (r.resolvedAt!.getTime() - r.arrivedAt.getTime()) / DAY)
    .sort((a, b) => a - b);
  if (spans.length === 0) return null;
  const mid = Math.floor(spans.length / 2);
  const median = spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
  return Math.round(median * 10) / 10;
}
