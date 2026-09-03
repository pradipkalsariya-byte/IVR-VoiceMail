// Feedback #30 — Oversight answering both "where is the system failing" and "what are
// families asking about". Nobody is scored: nothing here aggregates by person, by rule.
import { describe, it, expect } from 'vitest';
import {
  ageingBuckets, healthSummary, demandByCategory, growing, medianResolutionDays,
  type OversightRow,
} from '../core/oversight';

const NOW = new Date('2026-08-26T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

const row = (over: Partial<OversightRow> = {}): OversightRow => ({
  category: 'transport', suggestedCategory: null, status: 'open', ownerId: 's1',
  arrivedAt: daysAgo(1), slaDueAt: null, firstReplyAt: null, resolvedAt: null, ...over,
});

describe('ageing', () => {
  it('bands open work by how long it has waited', () => {
    const b = ageingBuckets([
      row({ arrivedAt: daysAgo(0.2) }),
      row({ arrivedAt: daysAgo(2) }),
      row({ arrivedAt: daysAgo(5) }),
      row({ arrivedAt: daysAgo(10) }),
      row({ arrivedAt: daysAgo(60) }),
    ], NOW);
    expect(b.map(x => x.count)).toEqual([1, 1, 1, 1, 1]);
  });

  it('counts only OPEN work — resolved items are not ageing', () => {
    const b = ageingBuckets([
      row({ arrivedAt: daysAgo(30), status: 'resolved' }),
      row({ arrivedAt: daysAgo(30), status: 'unfiled' }),
      row({ arrivedAt: daysAgo(30), status: 'open' }),
    ], NOW);
    expect(b.find(x => x.key === 'older')!.count).toBe(1);
  });

  it('puts the very oldest in the last band rather than dropping it', () => {
    const b = ageingBuckets([row({ arrivedAt: daysAgo(4000) })], NOW);
    expect(b.at(-1)!.count).toBe(1);
  });
});

describe('health summary', () => {
  it('counts open, unowned, breached and awaiting-first-reply', () => {
    const h = healthSummary([
      row({ ownerId: null }),
      row({ slaDueAt: daysAgo(1), firstReplyAt: null }),
      row({ firstReplyAt: daysAgo(0.5) }),
      row({ status: 'resolved' }),
    ], NOW);
    expect(h.open).toBe(3);
    expect(h.unowned).toBe(1);
    expect(h.breached).toBe(1);
    expect(h.awaitingFirstReply).toBe(2);
  });

  it('does not count a breach once the family has been replied to', () => {
    const h = healthSummary([row({ slaDueAt: daysAgo(3), firstReplyAt: daysAgo(2) })], NOW);
    expect(h.breached).toBe(0);
  });

  it('reports the oldest open item as NULL when nothing is open, not 0', () => {
    // "Nothing is open" and "the oldest is under a day" are different states.
    expect(healthSummary([], NOW).oldestOpenDays).toBeNull();
    expect(healthSummary([row({ status: 'resolved' })], NOW).oldestOpenDays).toBeNull();
    expect(healthSummary([row({ arrivedAt: daysAgo(0.5) })], NOW).oldestOpenDays).toBe(0);
  });
});

describe('demand', () => {
  const rows = [
    // current fortnight
    ...Array.from({ length: 8 }, () => row({ category: 'fees', arrivedAt: daysAgo(3) })),
    ...Array.from({ length: 5 }, () => row({ category: 'transport', arrivedAt: daysAgo(3) })),
    // previous fortnight
    ...Array.from({ length: 2 }, () => row({ category: 'fees', arrivedAt: daysAgo(20) })),
    ...Array.from({ length: 5 }, () => row({ category: 'transport', arrivedAt: daysAgo(20) })),
    // older than both windows — ignored entirely
    row({ category: 'fees', arrivedAt: daysAgo(200) }),
  ];

  it('compares two equal windows', () => {
    const d = demandByCategory(rows, NOW);
    const fees = d.find(x => x.category === 'fees')!;
    expect(fees.current).toBe(8);
    expect(fees.previous).toBe(2);
    expect(fees.change).toBeCloseTo(3);
  });

  it('sorts by current volume', () => {
    expect(demandByCategory(rows, NOW)[0].category).toBe('fees');
  });

  it('reports change as NULL when the previous window was empty', () => {
    // A rise from nothing has no percentage; "+100%" would be inventing a number.
    const d = demandByCategory([row({ category: 'uniform', arrivedAt: daysAgo(2) })], NOW);
    expect(d[0].change).toBeNull();
  });

  it('uses the suggested category when nothing has been filed', () => {
    const d = demandByCategory([row({ category: null, suggestedCategory: 'fees', arrivedAt: daysAgo(1) })], NOW);
    expect(d[0].category).toBe('fees');
  });

  it('ignores rows with no category at all rather than inventing a bucket', () => {
    const d = demandByCategory([row({ category: null, suggestedCategory: null })], NOW);
    expect(d).toEqual([]);
  });
});

describe('what is growing', () => {
  const demand = demandByCategory([
    ...Array.from({ length: 8 }, () => row({ category: 'fees', arrivedAt: daysAgo(3) })),
    ...Array.from({ length: 2 }, () => row({ category: 'fees', arrivedAt: daysAgo(20) })),
    ...Array.from({ length: 5 }, () => row({ category: 'transport', arrivedAt: daysAgo(3) })),
    ...Array.from({ length: 5 }, () => row({ category: 'transport', arrivedAt: daysAgo(20) })),
    // small but volatile: 1 -> 3 is +200% and almost certainly noise
    row({ category: 'uniform', arrivedAt: daysAgo(20) }),
    ...Array.from({ length: 3 }, () => row({ category: 'uniform', arrivedAt: daysAgo(3) })),
  ], NOW);

  it('surfaces a real rise', () => {
    expect(growing(demand).map(d => d.category)).toContain('fees');
  });

  it('does NOT cry wolf over small numbers', () => {
    // Without a volume floor the page would flag something every fortnight.
    expect(growing(demand).map(d => d.category)).not.toContain('uniform');
  });

  it('does not flag a flat category', () => {
    expect(growing(demand).map(d => d.category)).not.toContain('transport');
  });
});

describe('median resolution time', () => {
  it('uses the MEDIAN, so one ancient case does not distort it', () => {
    const rows = [
      row({ status: 'resolved', arrivedAt: daysAgo(3), resolvedAt: daysAgo(2) }),
      row({ status: 'resolved', arrivedAt: daysAgo(4), resolvedAt: daysAgo(3) }),
      row({ status: 'resolved', arrivedAt: daysAgo(200), resolvedAt: daysAgo(1) }),
    ];
    expect(medianResolutionDays(rows, NOW)).toBe(1);
  });

  it('is NULL when nothing resolved in the window', () => {
    expect(medianResolutionDays([row()], NOW)).toBeNull();
  });
});
