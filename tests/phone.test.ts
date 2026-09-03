import { describe, it, expect } from 'vitest';
import { normalisePhone } from '../core/phone';

describe('normalisePhone', () => {
  it('keeps the last 10 digits, stripping everything else', () => {
    expect(normalisePhone('+91 99000 00123')).toBe('9900000123');
    expect(normalisePhone('(099000) 00123')).toBe('9900000123');
    expect(normalisePhone('9900000123')).toBe('9900000123');
  });

  it('rejects anything under 10 digits rather than returning a short key', () => {
    expect(normalisePhone('123456789')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('abc')).toBeNull();
  });

  it('the same raw input always normalises to the same key — the whole point of extracting this', () => {
    // Two different report formats writing the same real number differently must still match.
    expect(normalisePhone('0091-9900000123')).toBe(normalisePhone('9900000123'));
  });
});
