// tools/csv/inspect.ts — inspect a front-desk spreadsheet export WITHOUT printing raw PII.
//
//   npx tsx tools/csv/inspect.ts "<file.csv>"
//
// Prints: column names, row count, per-column fill rate, distinct values for low-cardinality
// columns (which is how the real category vocabulary is discovered), and a redacted sample.
// Everything runs locally; nothing is written.

import { readFileSync } from 'node:fs';
import { redact } from '../mbox/redact';
import { parseCsv } from './parse-csv';

const file = process.argv[2];
if (!file) { console.error('usage: tsx tools/csv/inspect.ts "<file.csv>"'); process.exit(1); }

const rows = parseCsv(readFileSync(file, 'utf8'));
if (!rows.length) { console.error('empty file'); process.exit(1); }

const header = rows[0].map((h, i) => (h.trim() || `col${i}`).replace(/\s+/g, ' '));
const body = rows.slice(1);

console.log(`File: ${file}`);
console.log(`Rows: ${body.length} data rows, ${header.length} columns\n`);

console.log('=== COLUMNS ===');
header.forEach((h, i) => {
  const vals = body.map(r => (r[i] ?? '').trim());
  const filled = vals.filter(v => v !== '').length;
  const distinct = new Set(vals.filter(v => v !== ''));
  console.log(
    `${String(i).padStart(2)}  ${h.slice(0, 42).padEnd(44)} filled ${String(filled).padStart(4)}/${body.length}` +
    ` (${Math.round((100 * filled) / body.length)}%)  distinct ${distinct.size}`,
  );
});

console.log('\n=== LOW-CARDINALITY COLUMNS (the real vocabulary) ===');
header.forEach((h, i) => {
  const vals = body.map(r => (r[i] ?? '').trim()).filter(v => v !== '');
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size === 0 || counts.size > 40) return;
  console.log(`\n[${i}] ${h}  (${counts.size} distinct)`);
  [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40)
    .forEach(([v, n]) => console.log(`      ${String(n).padStart(4)}  ${redact(v).slice(0, 90)}`));
});

console.log('\n=== REDACTED SAMPLE ROWS ===');
for (const idx of [0, 1, Math.floor(body.length / 2), body.length - 1]) {
  const r = body[idx];
  if (!r) continue;
  console.log(`\n--- row ${idx + 2} ---`);
  header.forEach((h, i) => {
    const v = (r[i] ?? '').trim();
    if (!v) return;
    console.log(`  ${h.slice(0, 34).padEnd(36)} ${redact(v).replace(/\s+/g, ' ').slice(0, 110)}`);
  });
}
