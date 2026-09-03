// tools/csv/call-log-analyse.ts — analyse the FSK Daily Call Log sheet.
//
//   npx tsx tools/csv/call-log-analyse.ts "<file.csv>"
//
// The desk already logs calls in a spreadsheet with a consistent 12-column discipline. This
// reads it to answer: how many calls a day, who takes them, who they get routed to, how many
// need follow-up, and how clean the data is. Child names are never printed.

import { readFileSync } from 'node:fs';
import { parseCsv, resolveMixedDates, isoKey } from './parse-csv';

const file = process.argv[2];
if (!file) { console.error('usage: tsx tools/csv/call-log-analyse.ts "<file.csv>"'); process.exit(1); }

const rows = parseCsv(readFileSync(file, 'utf8'));
const body = rows.slice(1);
const col = (r: string[], i: number) => (r[i] ?? '').trim();

// ---------------------------------------------------------------------------- dates
const dateCol = body.map(r => col(r, 0)).filter(Boolean);
const D = resolveMixedDates(dateCol);

const perDay = new Map<string, number>();
for (const r of D.resolved) perDay.set(isoKey(r), (perDay.get(isoKey(r)) ?? 0) + 1);
const days = [...perDay].sort((a, b) => (a[0] < b[0] ? -1 : 1));

console.log('=== VOLUME ===');
console.log(`Rows: ${body.length}`);
console.log(`Distinct days: ${days.length}  (${days[0]?.[0]} → ${days[days.length - 1]?.[0]})`);
const counts = days.map(([, n]) => n).sort((a, b) => a - b);
console.log(`Calls/day — min ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, max ${counts[counts.length - 1]}, mean ${(body.length / days.length).toFixed(1)}`);
console.log(`\nDate format: ${D.ddmm} rows read as DD/MM, ${D.mmdd} as MM/DD, ${D.ambiguous} still ambiguous`);
console.log(`Active months detected: ${D.likelyMonths.join(', ')}`);
console.log('\nBusiest days:');
days.slice().sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([d, n]) => console.log(`   ${d}  ${n}`));

// ---------------------------------------------------------------------------- tallies
const tally = (i: number, clean = (s: string) => s) => {
  const m = new Map<string, number>();
  for (const r of body) {
    const v = clean(col(r, i));
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};

const show = (title: string, list: Array<[string, number]>, lim = 25) => {
  console.log(`\n=== ${title} (${list.length} distinct) ===`);
  list.slice(0, lim).forEach(([v, n]) =>
    console.log(`  ${String(n).padStart(4)}  ${v.slice(0, 76)}`));
  if (list.length > lim) {
    const tail = list.slice(lim).reduce((s, [, n]) => s + n, 0);
    console.log(`  ${String(tail).padStart(4)}  …${list.length - lim} more values`);
  }
};

show('CALLS RECEIVED BY', tally(4));
show('CALLER RELATIONSHIP', tally(3));
show('CALL TYPE (as recorded)', tally(5));
show('FOLLOW-UP REQUIRED', tally(8));
show('MESSAGE PASSED TO — the routing table', tally(7), 30);

// ---------------------------------------------------------------------------- data quality
console.log('\n=== DATA QUALITY ===');
const grade = tally(10);
const dirty = grade.filter(([v]) => /#REF|^NA$|\s{2,}|alumni/i.test(v));
console.log(`Grade column: ${grade.length} distinct values, ${dirty.length} dirty —`);
dirty.forEach(([v, n]) => console.log(`     ${String(n).padStart(3)}  "${v}"`));
for (const [i, name] of [[2, 'Student/person name'], [10, 'Grade'], [11, 'Section'], [6, 'Information'], [7, 'Message passed to']] as Array<[number, string]>) {
  const blank = body.filter(r => !col(r, i)).length;
  console.log(`Blank "${name}": ${blank} of ${body.length} (${Math.round((100 * blank) / body.length)}%)`);
}

// ---------------------------------------------------------------------------- what calls are about
console.log('\n=== WHAT THE CALLS ARE ABOUT (keyword frequency in Information) ===');
const TOPICS: Array<[string, RegExp]> = [
  ['absence / leave', /\b(absent|leave|sick|not coming|won.t come|fever)\b/i],
  ['pick-up / transport', /\b(bus|pick ?up|drop|transport|van|stop|gate)\b/i],
  ['speak to a teacher', /\b(speak|talk|connect|wanted to (speak|talk)|call back)\b/i],
  ['fees / payment', /\b(fee|fees|payment|receipt|refund|dues)\b/i],
  ['certificates / documents', /\b(bonafide|certificate|\bTC\b|document|form|letter|parcel)\b/i],
  ['systems / nucleus / app', /\b(nucleus|app|portal|login|password|error|otp)\b/i],
  ['admission', /\b(admission|enquir|inquir|registration)\b/i],
  ['exam / academics', /\b(exam|result|marks|test|homework|assignment)\b/i],
  ['event / activity', /\b(mela|event|trip|camp|competition|practice|workshop)\b/i],
  ['sickbay / health', /\b(sickbay|unwell|vomit|injur|medicine|health)\b/i],
  ['lost / found', /\b(lost|found|missing|tiffin|bottle|belonging)\b/i],
  ['uniform', /\b(uniform|shoes|dress)\b/i],
];
const info = body.map(r => `${col(r, 6)} ${col(r, 9)}`);
for (const [label, re] of TOPICS) {
  const n = info.filter(s => re.test(s)).length;
  console.log(`  ${String(n).padStart(4)}  ${label}  (${Math.round((100 * n) / body.length)}%)`);
}
const unmatched = info.filter(s => s.trim() && !TOPICS.some(([, re]) => re.test(s))).length;
console.log(`  ${String(unmatched).padStart(4)}  matched none of the above`);
