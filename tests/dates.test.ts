import { describe, expect, it } from 'vitest';
import { formatInstantIST, formatInstantShortIST } from '../core/dates';

// Fixed instants, asserted exactly: the zone is pinned to IST inside the formatter, so these
// pass identically under UTC, IST and any other machine zone.
describe('formatInstantIST', () => {
  it('renders the estate DD-MMM-YYYY form with a 12-hour clock', () => {
    expect(formatInstantIST(new Date('2026-08-04T03:30:00Z'))).toBe('04-Aug-2026, 09:00 am');
  });

  it('crosses the day boundary in IST, not the machine zone', () => {
    // 18:30 UTC is exactly midnight IST of the NEXT day.
    expect(formatInstantIST(new Date('2026-01-31T18:30:00Z'))).toBe('01-Feb-2026, 12:00 am');
  });

  it('September is Sep, never ICU’s four-letter Sept', () => {
    expect(formatInstantIST(new Date('2026-09-14T06:45:00Z'))).toBe('14-Sep-2026, 12:15 pm');
  });
});

describe('formatInstantShortIST', () => {
  it('drops only the year', () => {
    expect(formatInstantShortIST(new Date('2026-08-04T03:30:00Z'))).toBe('04-Aug, 09:00 am');
  });
});
