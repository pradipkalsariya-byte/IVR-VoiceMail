// core/dates.ts — instant formatting for the staff face. PURE (deterministic; the zone is
// pinned, never read from the machine).
//
// The estate display rule is DD-MMM-YYYY (repo CLAUDE.md): month names come from our own
// table rather than Intl's month:'short', because ICU renders September as "Sept" in the
// very locales we'd reach for — a four-letter month that breaks the rule while looking
// deliberate. Intl is used ONLY to shift the instant into IST (zone data is the one thing
// worth borrowing); every visible token is derived arithmetically. The 12-hour clock too:
// asking ICU for hour12 rendered "00:15 pm" on CI's ICU and "12:15 pm" locally — the same
// build, two answers (hour-cycle data differs by ICU version). h23 is stable everywhere,
// and noon-is-12 is our own modulo, not locale data. Caught by ci-front-desk on the first
// push of this file, one line below a comment warning about exactly this class of drift.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function istParts(d: Date): { day: string; month: string; year: string; hhmm: string; ap: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const monthIndex = Number(get('month')) - 1;
  const h23 = Number(get('hour'));
  const h12 = h23 % 12 === 0 ? 12 : h23 % 12;
  return {
    day: get('day'),
    month: MONTHS[monthIndex] ?? String(monthIndex + 1),
    year: get('year'),
    hhmm: `${String(h12).padStart(2, '0')}:${get('minute')}`,
    ap: h23 < 12 ? 'am' : 'pm',
  };
}

/** "04-Aug-2026, 09:00 am" — the full form, for record pages and the trail. */
export function formatInstantIST(d: Date): string {
  const p = istParts(d);
  return `${p.day}-${p.month}-${p.year}, ${p.hhmm} ${p.ap}`;
}

/** "04-Aug, 09:00 am" — the compact form for list rows, where the year is almost always
 *  this one and the column is the scarce resource. */
export function formatInstantShortIST(d: Date): string {
  const p = istParts(d);
  return `${p.day}-${p.month}, ${p.hhmm} ${p.ap}`;
}
