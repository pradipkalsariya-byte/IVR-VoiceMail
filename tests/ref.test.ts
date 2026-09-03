import { describe, it, expect } from 'vitest';
import { nextRefNumber } from '../core/ref';

// REGRESSION (2026-08-12): every call site used to derive the next ref from
// db.request.count(), which silently breaks the moment any row is ever deleted — count()
// undershoots the true high-water mark, and the next generated ref collides with a
// still-existing high-numbered row. MAX(ref) is the fix; these pin the arithmetic.
describe('nextRefNumber — derives from the high-water mark, never a row count', () => {
  it('starts at 1 on an empty table', () => {
    expect(nextRefNumber(null)).toBe(1);
  });

  it('is one past the current max, regardless of how many rows actually exist', () => {
    expect(nextRefNumber('FD-0064')).toBe(65);
    // The scenario that broke: 334 rows existed, 149 got deleted (185 remain), but the
    // surviving high-water mark was still FD-0283 — count()-based logic would have started
    // renumbering from 186 and collided with every survivor between 186 and 283.
    expect(nextRefNumber('FD-0283')).toBe(284);
  });

  it('reads the numeric suffix correctly at every width it actually takes', () => {
    expect(nextRefNumber('FD-0001')).toBe(2);
    expect(nextRefNumber('FD-0999')).toBe(1000);
    expect(nextRefNumber('FD-9999')).toBe(10000);
  });
});
