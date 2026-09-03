import { describe, it, expect } from 'vitest';
import { guessNameFromAddress, emailVariants, campusForAddress } from '../core/senders';

describe('guessNameFromAddress', () => {
  it('extracts a title-cased name from a parent address', () => {
    expect(guessNameFromAddress('p.aarav.shah@fsksurat.in')).toBe('Aarav Shah');
    expect(guessNameFromAddress('p.diya.mehta@fwgs.in')).toBe('Diya Mehta');
  });

  it('extracts a name from a student address the same way', () => {
    expect(guessNameFromAddress('s.rohan.patel@fountainheadschools.org')).toBe('Rohan Patel');
  });

  it('strips the graduation-year prefix off an alumnus address', () => {
    expect(guessNameFromAddress('a2026.priya.desai@fsksurat.in')).toBe('Priya Desai');
  });

  it('handles more or fewer than two name segments', () => {
    expect(guessNameFromAddress('p.aarav@fsksurat.in')).toBe('Aarav');
    expect(guessNameFromAddress('p.mary.jane.smith@fwgs.in')).toBe('Mary Jane Smith');
  });

  it('normalises case regardless of how the address happened to be written', () => {
    expect(guessNameFromAddress('P.AARAV.SHAH@FSKSURat.in')).toBe('Aarav Shah');
  });

  it('refuses off-domain addresses even when the local-part matches the pattern', () => {
    // The exact isFrom() trap the file's own comment warns about, for this function too.
    expect(guessNameFromAddress('p.mehta@somesupplier.test')).toBeNull();
  });

  it('returns null for staff, machine and other non-matching addresses', () => {
    expect(guessNameFromAddress('admissions@fsksurat.in')).toBeNull();
    expect(guessNameFromAddress('donotreply@fsksurat.in')).toBeNull();
    expect(guessNameFromAddress('not-an-email')).toBeNull();
  });

  it('returns null rather than a bare prefix when nothing follows the dot', () => {
    expect(guessNameFromAddress('p.@fsksurat.in')).toBeNull();
  });
});

describe('emailVariants', () => {
  it('returns both alias domains for a p./s. address, given one first', () => {
    expect(emailVariants('p.aarav.shah@fsksurat.in')).toEqual([
      'p.aarav.shah@fsksurat.in',
      'p.aarav.shah@fountainheadschools.org',
    ]);
    expect(emailVariants('s.diya.mehta@fountainheadschools.org')).toEqual([
      's.diya.mehta@fountainheadschools.org',
      's.diya.mehta@fsksurat.in',
    ]);
  });

  it('is a no-op for addresses outside the narrow alias pattern', () => {
    // FWGS has no evidenced alias pair — widening it would be a guess, not a finding.
    expect(emailVariants('p.rohan.patel@fwgs.in')).toEqual(['p.rohan.patel@fwgs.in']);
    expect(emailVariants('admissions@fsksurat.in')).toEqual(['admissions@fsksurat.in']);
  });

  it('normalises case and whitespace before comparing', () => {
    expect(emailVariants(' P.Aarav.Shah@FSKSURAT.IN ')).toEqual([
      'p.aarav.shah@fsksurat.in',
      'p.aarav.shah@fountainheadschools.org',
    ]);
  });
});

describe('campusForAddress', () => {
  it('maps each known domain to its campus', () => {
    expect(campusForAddress('p.aarav.shah@fwgs.in')).toBe('fwgs');
    expect(campusForAddress('p.aarav.shah@fsksurat.in')).toBe('fsk');
    expect(campusForAddress('p.aarav.shah@fountainheadschools.org')).toBe('fsk');
  });

  it('refuses rather than guesses for an unrecognised domain', () => {
    expect(campusForAddress('p.aarav.shah@fsmsurat.in')).toBeNull();
    expect(campusForAddress('p.aarav.shah@gmail.com')).toBeNull();
    expect(campusForAddress('not-an-email')).toBeNull();
  });

  it('is case-insensitive on the domain', () => {
    expect(campusForAddress('p.aarav.shah@FWGS.IN')).toBe('fwgs');
  });
});
