// Feedback #8/#9 — grouping missed-call slips by who rang. All numbers below are from the
// reserved 9900000xxx block (see tests/no-real-data.test.ts).
import { describe, it, expect } from 'vitest';
import { callerPhone, groupCallers, callerDisplayName, type CallerSlip } from '../core/switchboard';

const at = (iso: string) => new Date(iso);
const slip = (id: string, phone: string | null, iso: string, familyLabel: string | null = null): CallerSlip => ({
  id, ref: `FD-${id}`,
  subject: phone ? `Missed call at 14:52 — ${phone}` : 'Missed call logged at the desk',
  arrivedAt: at(iso), campusCode: 'FSK', familyLabel,
});

describe('reading the caller number', () => {
  it('pulls a trailing 10-digit number out of the subject', () => {
    expect(callerPhone('Missed call at 14:52 — 9900000216')).toBe('9900000216');
  });

  it('returns null rather than guessing when there is no number', () => {
    expect(callerPhone('Missed call logged at the desk')).toBeNull();
    expect(callerPhone('')).toBeNull();
  });

  it('does not mistake the time for the number', () => {
    expect(callerPhone('Missed call at 14:52 — 9900000216')).not.toBe('1452');
  });
});

describe('grouping by caller', () => {
  it('collapses repeat calls from one number into a single row', () => {
    const groups = groupCallers([
      slip('1', '9900000216', '2026-08-26T09:00:00Z'),
      slip('2', '9900000216', '2026-08-26T10:00:00Z'),
      slip('3', '9900000216', '2026-08-26T11:00:00Z'),
      slip('4', '9900000777', '2026-08-26T08:00:00Z'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].calls).toHaveLength(3);
    expect(groups[0].phone).toBe('9900000216');
  });

  it('orders callers by who rang most recently', () => {
    const groups = groupCallers([
      slip('1', '9900000111', '2026-08-26T08:00:00Z'),
      slip('2', '9900000222', '2026-08-26T12:00:00Z'),
    ]);
    expect(groups.map(g => g.phone)).toEqual(['9900000222', '9900000111']);
  });

  it('orders a caller OWN calls newest first', () => {
    const groups = groupCallers([
      slip('1', '9900000216', '2026-08-26T09:00:00Z'),
      slip('2', '9900000216', '2026-08-26T13:00:00Z'),
    ]);
    expect(groups[0].calls.map(c => c.id)).toEqual(['2', '1']);
    expect(groups[0].lastAt).toEqual(at('2026-08-26T13:00:00Z'));
  });

  it('keeps un-numbered slips SEPARATE — merging them would invent one caller from many', () => {
    const groups = groupCallers([
      slip('1', null, '2026-08-26T09:00:00Z'),
      slip('2', null, '2026-08-26T10:00:00Z'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('picks up a family name from any slip in the group, not just the first', () => {
    // The roster may have gained the number between two calls.
    const groups = groupCallers([
      slip('1', '9900000216', '2026-08-26T09:00:00Z', null),
      slip('2', '9900000216', '2026-08-26T10:00:00Z', 'Parents of Ridhan Joshi'),
    ]);
    expect(groups[0].familyLabel).toBe('Parents of Ridhan Joshi');
  });

  it('returns nothing for no slips', () => {
    expect(groupCallers([])).toEqual([]);
  });
});

describe('what the caller is called on screen', () => {
  it('prefers the family name', () => {
    expect(callerDisplayName({ familyLabel: 'Parents of Ridhan Joshi', phone: '9900000216' }))
      .toBe('Parents of Ridhan Joshi');
  });

  it('falls back to the NUMBER, never to "unknown" — you can ring a number you cannot name', () => {
    expect(callerDisplayName({ familyLabel: null, phone: '9900000216' })).toBe('9900000216');
  });

  it('only says nothing when there is genuinely nothing', () => {
    expect(callerDisplayName({ familyLabel: null, phone: null })).toBe('Caller not recorded');
  });
});
