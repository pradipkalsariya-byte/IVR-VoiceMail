// core/queue-filters.ts — narrowing a list of requests, from URL parameters.
//
// Feedback #11 (transcript 00:14:09, "there are no filters in any of these" / "add filters
// everywhere"). Built URL-driven rather than as component state so that a filtered view is a
// LINK: shareable in chat, survivable across a refresh, and back-button-able. A desk person
// saying "look at the transport ones" should be able to send the screen, not the instructions.
//
// This is also the groundwork for #28, the category-tabbed view. A tab is a category filter
// with a bigger click target — so the tabs will read these same functions rather than growing
// a second, subtly different idea of what "transport" means.

export interface FilterableRequest {
  category: string | null;
  suggestedCategory: string | null;
  channel: string;
  status: string;
  ownerId?: string | null;
  subject: string;
  body: string;
  isSwitchboard: boolean;
}

export interface QueueFilters {
  /** A category key, or 'all'. Matches the FILED category, falling back to the suggested one. */
  category: string;
  /** email | call | whatsapp | walkin | staff | event | app, or 'all'. */
  channel: string;
  /** all | unfiled | working | unowned */
  state: string;
  /** Free text over subject and body. */
  q: string;
}

export const EMPTY_FILTERS: QueueFilters = { category: 'all', channel: 'all', state: 'all', q: '' };

/** Read filters out of URL search params, defaulting anything absent or unrecognised. */
export function filtersFromParams(params: Record<string, string | undefined>): QueueFilters {
  return {
    category: params.cat?.trim() || 'all',
    channel: params.ch?.trim() || 'all',
    state: params.state?.trim() || 'all',
    q: (params.q ?? '').trim(),
  };
}

/** Back to a query string, dropping defaults so a clean view has a clean URL. */
export function filtersToQuery(f: QueueFilters): string {
  const p = new URLSearchParams();
  if (f.category !== 'all') p.set('cat', f.category);
  if (f.channel !== 'all') p.set('ch', f.channel);
  if (f.state !== 'all') p.set('state', f.state);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function hasAnyFilter(f: QueueFilters): boolean {
  return f.category !== 'all' || f.channel !== 'all' || f.state !== 'all' || f.q !== '';
}

/**
 * The category a request should be FILTERED by.
 *
 * The filed category wins; the suggestion is the fallback. Filtering only on the filed value
 * would make the filters useless on exactly the items that need attention most — the unfiled
 * ones, which is the bulk of the queue and the whole reason someone reaches for a filter.
 */
export function effectiveCategory(r: Pick<FilterableRequest, 'category' | 'suggestedCategory'>): string | null {
  return r.category ?? r.suggestedCategory ?? null;
}

export function matchesFilters(r: FilterableRequest, f: QueueFilters): boolean {
  if (f.category !== 'all' && effectiveCategory(r) !== f.category) return false;
  if (f.channel !== 'all' && r.channel !== f.channel) return false;

  if (f.state === 'unfiled' && r.status !== 'unfiled') return false;
  if (f.state === 'working' && r.status !== 'open' && r.status !== 'waiting') return false;
  if (f.state === 'unowned') {
    const working = r.status === 'open' || r.status === 'waiting';
    if (!working || r.ownerId) return false;
  }

  if (f.q) {
    // Case-insensitive substring over what a person can actually see on the card. Not the
    // sender address: searching for "priya" should not surface every mail from a domain that
    // happens to contain it.
    const needle = f.q.toLowerCase();
    const hay = `${r.subject} ${r.body}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }

  return true;
}

/**
 * How many items each category option would show, given everything ELSE that is filtered.
 *
 * Counted against the other active filters rather than the whole list, so the numbers beside
 * each option tell the truth about what clicking it would do. A count that ignores the current
 * channel filter promises rows that are not there.
 */
export function categoryCounts(
  rows: readonly FilterableRequest[],
  f: QueueFilters,
): Map<string, number> {
  const withoutCategory: QueueFilters = { ...f, category: 'all' };
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!matchesFilters(r, withoutCategory)) continue;
    const c = effectiveCategory(r);
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
}
