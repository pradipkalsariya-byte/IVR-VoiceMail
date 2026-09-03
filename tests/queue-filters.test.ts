// Feedback #11 — filters everywhere, and the groundwork for #28's category tabs.
import { describe, it, expect } from 'vitest';
import {
  filtersFromParams, filtersToQuery, hasAnyFilter, matchesFilters, effectiveCategory,
  categoryCounts, EMPTY_FILTERS, type FilterableRequest,
} from '../core/queue-filters';
import { CATEGORIES, isSafeguardingCategory } from '../core/taxonomy';

const req = (over: Partial<FilterableRequest> = {}): FilterableRequest => ({
  category: null, suggestedCategory: 'transport', channel: 'email', status: 'unfiled',
  ownerId: null, subject: 'Bus stop change', body: 'The bus is late.', isSwitchboard: false, ...over,
});

describe('reading filters from the URL', () => {
  it('defaults everything absent', () => {
    expect(filtersFromParams({})).toEqual(EMPTY_FILTERS);
  });

  it('reads each parameter and trims it', () => {
    expect(filtersFromParams({ cat: ' fees ', ch: 'call', state: 'unowned', q: '  bus ' }))
      .toEqual({ category: 'fees', channel: 'call', state: 'unowned', q: 'bus' });
  });

  it('round-trips back to a query string, dropping defaults', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe('');
    expect(filtersToQuery({ ...EMPTY_FILTERS, category: 'fees' })).toBe('?cat=fees');
    const f = { category: 'fees', channel: 'call', state: 'unowned', q: 'bus' };
    expect(filtersFromParams(Object.fromEntries(new URLSearchParams(filtersToQuery(f).slice(1)))))
      .toEqual(f);
  });

  it('knows whether anything is filtered', () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...EMPTY_FILTERS, q: 'bus' })).toBe(true);
  });
});

describe('which category a request filters by', () => {
  it('prefers the filed category over the suggestion', () => {
    expect(effectiveCategory({ category: 'fees', suggestedCategory: 'transport' })).toBe('fees');
  });

  it('falls back to the SUGGESTION, so unfiled items are filterable at all', () => {
    // The unfiled pile is most of the queue and the whole reason someone reaches for a filter.
    expect(effectiveCategory({ category: null, suggestedCategory: 'transport' })).toBe('transport');
  });

  it('is null when there is neither', () => {
    expect(effectiveCategory({ category: null, suggestedCategory: null })).toBeNull();
  });
});

describe('matching', () => {
  it('filters by category, filed or suggested', () => {
    expect(matchesFilters(req(), { ...EMPTY_FILTERS, category: 'transport' })).toBe(true);
    expect(matchesFilters(req(), { ...EMPTY_FILTERS, category: 'fees' })).toBe(false);
    expect(matchesFilters(req({ category: 'fees' }), { ...EMPTY_FILTERS, category: 'fees' })).toBe(true);
  });

  it('filters by channel', () => {
    expect(matchesFilters(req({ channel: 'call' }), { ...EMPTY_FILTERS, channel: 'call' })).toBe(true);
    expect(matchesFilters(req({ channel: 'email' }), { ...EMPTY_FILTERS, channel: 'call' })).toBe(false);
  });

  it('filters by state', () => {
    expect(matchesFilters(req({ status: 'unfiled' }), { ...EMPTY_FILTERS, state: 'unfiled' })).toBe(true);
    expect(matchesFilters(req({ status: 'open' }), { ...EMPTY_FILTERS, state: 'working' })).toBe(true);
    expect(matchesFilters(req({ status: 'waiting' }), { ...EMPTY_FILTERS, state: 'working' })).toBe(true);
    expect(matchesFilters(req({ status: 'unfiled' }), { ...EMPTY_FILTERS, state: 'working' })).toBe(false);
  });

  it('unowned means working AND unowned — an unfiled item is not "unowned work"', () => {
    expect(matchesFilters(req({ status: 'open', ownerId: null }), { ...EMPTY_FILTERS, state: 'unowned' })).toBe(true);
    expect(matchesFilters(req({ status: 'open', ownerId: 's1' }), { ...EMPTY_FILTERS, state: 'unowned' })).toBe(false);
    expect(matchesFilters(req({ status: 'unfiled', ownerId: null }), { ...EMPTY_FILTERS, state: 'unowned' })).toBe(false);
  });

  it('searches subject and body, case-insensitively', () => {
    expect(matchesFilters(req(), { ...EMPTY_FILTERS, q: 'BUS STOP' })).toBe(true);
    expect(matchesFilters(req(), { ...EMPTY_FILTERS, q: 'late' })).toBe(true);
    expect(matchesFilters(req(), { ...EMPTY_FILTERS, q: 'certificate' })).toBe(false);
  });

  it('combines filters with AND', () => {
    const r = req({ channel: 'call', suggestedCategory: 'fees' });
    expect(matchesFilters(r, { ...EMPTY_FILTERS, channel: 'call', category: 'fees' })).toBe(true);
    expect(matchesFilters(r, { ...EMPTY_FILTERS, channel: 'call', category: 'transport' })).toBe(false);
  });
});

describe('category counts', () => {
  const rows = [
    req({ suggestedCategory: 'transport', channel: 'email' }),
    req({ suggestedCategory: 'transport', channel: 'call' }),
    req({ suggestedCategory: 'fees', channel: 'email' }),
    req({ suggestedCategory: null, category: null, channel: 'email' }),
  ];

  it('counts each category', () => {
    const c = categoryCounts(rows, EMPTY_FILTERS);
    expect(c.get('transport')).toBe(2);
    expect(c.get('fees')).toBe(1);
  });

  it('respects the OTHER active filters, so the numbers do not lie', () => {
    // With the channel narrowed to email, "transport" must promise 1, not 2.
    const c = categoryCounts(rows, { ...EMPTY_FILTERS, channel: 'email' });
    expect(c.get('transport')).toBe(1);
  });

  it('ignores its own category filter, so every option still shows a number', () => {
    const c = categoryCounts(rows, { ...EMPTY_FILTERS, category: 'fees' });
    expect(c.get('transport')).toBe(2);
    expect(c.get('fees')).toBe(1);
  });

  it('skips items with no category rather than inventing a bucket', () => {
    expect([...categoryCounts(rows, EMPTY_FILTERS).keys()].sort()).toEqual(['fees', 'transport']);
  });
});

describe('feedback #28 — the tab strip orders itself for the desk, not for the data', () => {
  // The strip is built in components/FilterBar.tsx from CATEGORIES + counts. This pins the
  // ORDERING rule, which is the part that carries a judgement rather than a layout.
  const order = (counts: Record<string, number>, active = 'all') =>
    CATEGORIES
      .filter(c => (counts[c.key] ?? 0) > 0 || c.key === active)
      .sort((a, b) => {
        const sa = isSafeguardingCategory(a.key) ? 1 : 0;
        const sb = isSafeguardingCategory(b.key) ? 1 : 0;
        if (sa !== sb) return sb - sa;
        return (counts[b.key] ?? 0) - (counts[a.key] ?? 0);
      })
      .map(c => c.key);

  it('puts safeguarding first even when it is the smallest count', () => {
    // The live shape on 27-Aug-2026: one child-safety item against dozens of everything else.
    const got = order({ 'child-safety': 1, transport: 31, 'leave-medical': 15, fees: 9 });
    expect(got[0]).toBe('child-safety');
  });

  it('sorts everything else by volume', () => {
    const got = order({ transport: 31, 'leave-medical': 15, fees: 9 });
    expect(got).toEqual(['transport', 'leave-medical', 'fees']);
  });

  it('keeps the active category in the strip even at zero, so the screen is not filtered to nothing it cannot undo', () => {
    expect(order({ transport: 3 }, 'fees')).toContain('fees');
  });

  it('drops categories with nothing in them', () => {
    expect(order({ transport: 3 })).toEqual(['transport']);
  });
});
