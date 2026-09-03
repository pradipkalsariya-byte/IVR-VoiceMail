import { describe, it, expect } from 'vitest';
import { clockStart, addWorkingHours, slaDue, slaState, humanGap, DEFAULT_DESK } from '../core/sla';

// All fixtures are UTC. IST is UTC+5:30, so 02:30Z = 08:00 IST (desk open).
const utc = (iso: string) => new Date(iso);
const istHour = (d: Date) => new Date(+d + 330 * 60_000).getUTCHours();

describe('the clock starts at desk open, not on arrival', () => {
  it('starts immediately for a message inside desk hours', () => {
    const arrived = utc('2026-07-07T05:00:00Z'); // 10:30 IST, Tuesday
    expect(+clockStart(arrived)).toBe(+arrived);
  });

  it('defers a 06:00 IST arrival to 08:00 IST — the 26% peak finding', () => {
    const arrived = utc('2026-07-07T00:30:00Z'); // 06:00 IST Tuesday
    const start = clockStart(arrived);
    expect(istHour(start)).toBe(8);
    expect(+start).toBeGreaterThan(+arrived);
  });

  it('defers a 22:00 IST arrival to the next morning', () => {
    const arrived = utc('2026-07-07T16:30:00Z'); // 22:00 IST Tuesday
    const start = clockStart(arrived);
    expect(istHour(start)).toBe(8);
    expect(new Date(+start + 330 * 60_000).getUTCDate()).toBe(8); // Wednesday
  });

  it('defers a Sunday arrival to Monday', () => {
    const sunday = utc('2026-07-05T06:00:00Z'); // 11:30 IST Sunday
    const start = clockStart(sunday);
    const local = new Date(+start + 330 * 60_000);
    expect(local.getUTCDay()).toBe(1); // Monday
    expect(local.getUTCHours()).toBe(8);
  });

  it('treats Saturday as a working day — 17% of mail is weekend', () => {
    const saturday = utc('2026-07-04T05:00:00Z'); // 10:30 IST Saturday
    expect(+clockStart(saturday)).toBe(+saturday);
  });
});

describe('working-hour arithmetic', () => {
  it('adds hours inside a single day', () => {
    const from = utc('2026-07-07T03:30:00Z'); // 09:00 IST
    expect(istHour(addWorkingHours(from, 4))).toBe(13);
  });

  it('rolls over the close boundary into the next working day', () => {
    const from = utc('2026-07-07T10:30:00Z'); // 16:00 IST, one hour before close
    const due = addWorkingHours(from, 4); // 1h today + 3h tomorrow
    const local = new Date(+due + 330 * 60_000);
    expect(local.getUTCDate()).toBe(8);
    expect(local.getUTCHours()).toBe(11);
  });

  it('skips Sunday when rolling over', () => {
    const from = utc('2026-07-04T10:30:00Z'); // 16:00 IST Saturday
    const due = addWorkingHours(from, 4);
    const local = new Date(+due + 330 * 60_000);
    expect(local.getUTCDay()).toBe(1); // Monday, not Sunday
  });

  it('is a no-op for zero hours', () => {
    const from = utc('2026-07-07T05:00:00Z');
    expect(+addWorkingHours(from, 0)).toBe(+from);
  });
});

describe('targets by urgency', () => {
  it('gives a critical request one working hour', () => {
    const from = utc('2026-07-07T03:30:00Z'); // 09:00 IST
    expect(istHour(slaDue(from, 'critical'))).toBe(10);
  });

  it('gives a normal request exactly one working day — open to close', () => {
    // The desk runs 08:00-17:00 = 9 hours, and "normal" is 9 working hours. So a message
    // arriving at the opening bell is due at the closing bell, the same day.
    const from = utc('2026-07-07T02:30:00Z'); // 08:00 IST Tuesday
    const local = new Date(+slaDue(from, 'normal') + 330 * 60_000);
    expect(local.getUTCDate()).toBe(7);
    expect(local.getUTCHours()).toBe(17);
  });

  it('spills a normal request to the next day when it arrives mid-morning', () => {
    const from = utc('2026-07-07T05:30:00Z'); // 11:00 IST Tuesday
    const local = new Date(+slaDue(from, 'normal') + 330 * 60_000);
    expect(local.getUTCDate()).toBe(8); // Wednesday
    expect(local.getUTCHours()).toBe(11);
  });

  it('escalating urgency never lengthens the deadline', () => {
    const from = utc('2026-07-07T03:30:00Z');
    const crit = +slaDue(from, 'critical');
    const high = +slaDue(from, 'high');
    const normal = +slaDue(from, 'normal');
    const low = +slaDue(from, 'low');
    expect(crit).toBeLessThan(high);
    expect(high).toBeLessThan(normal);
    expect(normal).toBeLessThan(low);
  });
});

describe('slaState', () => {
  const now = utc('2026-07-07T06:00:00Z');

  it('reports met once a reply has gone out, even if late', () => {
    expect(slaState({ dueAt: utc('2026-07-07T04:00:00Z'), firstReplyAt: utc('2026-07-07T05:00:00Z'), now }))
      .toBe('met');
  });

  it('reports breached when the deadline has passed unanswered', () => {
    expect(slaState({ dueAt: utc('2026-07-07T05:00:00Z'), now })).toBe('breached');
  });

  it('warns due-soon inside the last hour', () => {
    expect(slaState({ dueAt: utc('2026-07-07T06:30:00Z'), now })).toBe('due-soon');
  });

  it('reports on-track with time to spare', () => {
    expect(slaState({ dueAt: utc('2026-07-07T09:00:00Z'), now })).toBe('on-track');
  });

  it('is on-track when no deadline is set — an unfiled item is not late', () => {
    expect(slaState({ dueAt: null, now })).toBe('on-track');
  });
});

describe('humanGap', () => {
  it('formats minutes, hours and days', () => {
    expect(humanGap(utc('2026-07-07T00:00:00Z'), utc('2026-07-07T00:45:00Z'))).toBe('45m');
    expect(humanGap(utc('2026-07-07T00:00:00Z'), utc('2026-07-07T02:00:00Z'))).toBe('2h');
    expect(humanGap(utc('2026-07-07T00:00:00Z'), utc('2026-07-07T02:20:00Z'))).toBe('2h 20m');
    expect(humanGap(utc('2026-07-07T00:00:00Z'), utc('2026-07-10T03:00:00Z'))).toBe('3d 3h');
  });

  it('is direction-agnostic', () => {
    const a = utc('2026-07-07T00:00:00Z'), b = utc('2026-07-07T02:00:00Z');
    expect(humanGap(a, b)).toBe(humanGap(b, a));
  });
});

describe('desk configuration is data, not code', () => {
  it('honours a different open time', () => {
    const desk = { ...DEFAULT_DESK, openMin: 9 * 60 };
    const arrived = utc('2026-07-07T02:45:00Z'); // 08:15 IST
    expect(istHour(clockStart(arrived, desk))).toBe(9);
  });

  it('honours a five-day week', () => {
    const desk = { ...DEFAULT_DESK, workingDays: [1, 2, 3, 4, 5] };
    const saturday = utc('2026-07-04T05:00:00Z');
    const local = new Date(+clockStart(saturday, desk) + 330 * 60_000);
    expect(local.getUTCDay()).toBe(1); // Monday
  });
});
