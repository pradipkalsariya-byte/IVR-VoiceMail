import { describe, it, expect } from 'vitest';
import { parseCsv, resolveMixedDates, isoKey } from '../tools/csv/parse-csv';

const iso = (labels: string[], preferred: 'dd/mm' | 'mm/dd' = 'dd/mm') =>
  resolveMixedDates(labels, preferred).resolved.map(isoKey);

describe('CSV parsing', () => {
  it('handles quoted fields containing commas and newlines', () => {
    const rows = parseCsv('a,"b,1","c\nd"\n1,2,3\n');
    expect(rows[0]).toEqual(['a', 'b,1', 'c\nd']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('handles escaped double quotes', () => {
    expect(parseCsv('x,"say ""hi"""')[0]).toEqual(['x', 'say "hi"']);
  });

  it('strips a BOM and drops fully blank rows', () => {
    expect(parseCsv('﻿a,b\n\n,\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('mixed DD/MM and MM/DD dates — row order is the evidence', () => {
  it('resolves unambiguous labels from the day component', () => {
    expect(iso(['15/07/2026', '31/07/2026'])).toEqual(['2026-07-15', '2026-07-31']);
  });

  it('reproduces the real FSK sequence as strictly chronological', () => {
    // The actual distinct labels from the live Daily Call Log, in file order. The intent is
    // DD/MM, but nine labels were stored MM/DD — and only row order reveals which.
    const labels = [
      '02/07/2026', '03/07/2026', '07/03/2026', '07/04/2026', '07/06/2026', '07/07/2026',
      '08/07/2026', '09/07/2026', '07/10/2026', '07/11/2026', '13/07/2026', '14/07/2026',
      '15/07/2026', '16/07/2026', '17/07/2026', '18/07/2026', '20/07/2026', '21/07/2026',
      '22/07/2026', '23/07/2026', '27/07/2026', '28/07/2026', '29/07/2026', '30/07/2026',
      '31/07/2026', '08/03/2026', '08/04/2026', '08/05/2026', '08/06/2026',
    ];
    const out = iso(labels);

    // Strictly increasing — the property that proves the reading.
    for (let i = 1; i < out.length; i++) expect(out[i] >= out[i - 1]).toBe(true);

    expect(out[0]).toBe('2026-07-02');
    expect(out[out.length - 1]).toBe('2026-08-06');
    // The four August labels, which a month-voting resolver read as March–June.
    expect(out.slice(-4)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']);
    // The mid-July ones it also got wrong.
    expect(out[2]).toBe('2026-07-03');
    expect(out[8]).toBe('2026-07-10');
  });

  it('counts how many labels were stored the unintended way round', () => {
    const r = resolveMixedDates([
      '02/07/2026', '03/07/2026', '07/03/2026', '13/07/2026', '31/07/2026', '08/05/2026',
    ]);
    expect(r.mmdd).toBeGreaterThan(0);
    expect(r.ddmm).toBeGreaterThan(0);
    expect(r.resolved.some(x => x.how.includes('keeps order'))).toBe(true);
  });

  it('never silently invents a date when the sequence genuinely goes backwards', () => {
    // 31 July then 01/02 — neither reading moves forward. Must be flagged, not guessed.
    const r = resolveMixedDates(['31/07/2026', '01/02/2026']);
    expect(r.ambiguous).toBe(1);
    expect(r.resolved[1].how).toMatch(/AMBIGUOUS/);
  });

  it('honours the stated intent as the tiebreak', () => {
    // A single label with no sequence to constrain it: 05/06 is 5 June under DD/MM.
    expect(iso(['05/06/2026'], 'dd/mm')).toEqual(['2026-06-05']);
    expect(iso(['05/06/2026'], 'mm/dd')).toEqual(['2026-05-06']);
  });

  it('is stable for an all-unambiguous log', () => {
    const labels = ['13/07/2026', '14/07/2026', '15/07/2026'];
    const r = resolveMixedDates(labels);
    expect(r.ambiguous).toBe(0);
    expect(r.mmdd).toBe(0);
    expect(iso(labels)).toEqual(['2026-07-13', '2026-07-14', '2026-07-15']);
  });
});
