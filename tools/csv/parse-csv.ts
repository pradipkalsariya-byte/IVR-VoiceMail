// tools/csv/parse-csv.ts — RFC 4180 CSV parser. PURE, no side effects.
//
// Kept in its own module deliberately: it was originally inside inspect.ts, and importing it
// from another script executed that script's whole analysis as an import side effect.

/** Parse CSV text into rows. Handles quoted fields containing commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export interface ResolvedDate { y: number; m: number; d: number; how: string }

/**
 * Resolve a date column that mixes DD/MM/YYYY and MM/DD/YYYY — a Google Sheets locale artefact
 * present in the real FSK call log, where the intended format is DD/MM but 9 of 29 distinct
 * labels (about a third of rows) were stored the other way round.
 *
 * ROW ORDER is the evidence, not month-frequency. A daily log is append-only, so its dates are
 * non-decreasing; the correct reading of an ambiguous label is the one that keeps the sequence
 * monotonic. An earlier version voted on which months looked "active" and got the whole August
 * block wrong — reading 08/05 as 8 May rather than 5 August — which mis-dated a third of the file
 * and reported a range starting in March.
 *
 * Pass `preferred` to say which way round the author INTENDED, used only to break a genuine tie.
 */
export function resolveMixedDates(
  raw: string[],
  preferred: 'dd/mm' | 'mm/dd' = 'dd/mm',
): { resolved: ResolvedDate[]; ddmm: number; mmdd: number; ambiguous: number; likelyMonths: number[] } {
  const parts = raw
    .map(s => s.split(/[/-]/).map(Number))
    .filter(p => p.length === 3 && p.every(n => !isNaN(n)));

  const asDay = (y: number, m: number, d: number) => y * 10000 + m * 100 + d;
  let ddmm = 0, mmdd = 0, ambiguous = 0;
  const resolved: ResolvedDate[] = [];
  let last = -Infinity; // the most recent resolved date, as a comparable integer

  for (const [a, b, y] of parts) {
    // Unambiguous: one component cannot be a month.
    if (a > 12) {
      resolved.push({ y, m: b, d: a, how: 'dd/mm (day>12)' }); ddmm++;
      last = asDay(y, b, a); continue;
    }
    if (b > 12) {
      resolved.push({ y, m: a, d: b, how: 'mm/dd (day>12)' }); mmdd++;
      last = asDay(y, a, b); continue;
    }

    // Both ≤ 12. Prefer whichever reading does not go backwards in time.
    const asDdmm = asDay(y, b, a);   // a = day,   b = month
    const asMmdd = asDay(y, a, b);   // a = month, b = day
    const ddOk = asDdmm >= last;
    const mmOk = asMmdd >= last;

    if (ddOk && !mmOk) {
      resolved.push({ y, m: b, d: a, how: 'dd/mm (keeps order)' }); ddmm++; last = asDdmm;
    } else if (mmOk && !ddOk) {
      resolved.push({ y, m: a, d: b, how: 'mm/dd (keeps order)' }); mmdd++; last = asMmdd;
    } else if (ddOk && mmOk) {
      // Both work — take the smaller forward step, then the author's intent as a tiebreak.
      const dGap = asDdmm - last, mGap = asMmdd - last;
      const useDd = dGap === mGap ? preferred === 'dd/mm' : dGap < mGap;
      if (useDd) { resolved.push({ y, m: b, d: a, how: 'dd/mm (nearest)' }); ddmm++; last = asDdmm; }
      else { resolved.push({ y, m: a, d: b, how: 'mm/dd (nearest)' }); mmdd++; last = asMmdd; }
    } else {
      // Neither keeps order — the sheet is genuinely out of sequence here. Honour intent and
      // say so, rather than silently inventing a date.
      const m = preferred === 'dd/mm' ? b : a;
      const d = preferred === 'dd/mm' ? a : b;
      resolved.push({ y, m, d, how: 'AMBIGUOUS (out of sequence)' }); ambiguous++;
      last = asDay(y, m, d);
    }
  }

  const months = new Set(resolved.map(r => r.m));
  return { resolved, ddmm, mmdd, ambiguous, likelyMonths: [...months].sort((x, y) => x - y) };
}

export const isoKey = (x: ResolvedDate) =>
  `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
