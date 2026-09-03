// Masking names by knowing them. Every name below is synthetic.
import { describe, it, expect } from 'vitest';
import { namesFromLabels, nameMatcher, maskKnownNames } from '../core/name-dictionary';

describe('pulling names out of what the database holds', () => {
  it('strips the "Parent of" prefix and keeps the whole name and each part', () => {
    expect(namesFromLabels(['Parent of Aarav Shah']).sort()).toEqual(['Aarav', 'Aarav Shah', 'Shah']);
  });

  it('handles the plural form too', () => {
    expect(namesFromLabels(['Parents of Dhyaana Morker'])).toContain('Dhyaana');
  });

  it('takes staff names as they come', () => {
    expect(namesFromLabels(['Ayushi Kalal'])).toContain('Ayushi Kalal');
  });

  it('skips seed rows, which are not people', () => {
    expect(namesFromLabels(['Family 41', 'Family 7'])).toEqual([]);
  });

  it('skips names too short to mask safely', () => {
    // "Ravi" is fine; "Om" would match inside dozens of ordinary words.
    const names = namesFromLabels(['Parent of Om Bhatt']);
    expect(names).not.toContain('Om');
    expect(names).toContain('Bhatt');
  });

  it('skips names that are also ordinary school words', () => {
    // A child called Harmony shares a name with a section; masking it would turn every
    // "Grade 1 Harmony" into "Grade 1 «name»".
    expect(namesFromLabels(['Parent of Harmony Shah'])).not.toContain('Harmony');
    expect(namesFromLabels(['Parent of Harmony Shah'])).toContain('Shah');
  });

  it('deduplicates across families', () => {
    const n = namesFromLabels(['Parent of Aarav Shah', 'Parent of Priya Shah']);
    expect(n.filter(x => x === 'Shah')).toHaveLength(1);
  });

  it('ignores blanks without throwing', () => {
    expect(namesFromLabels(['', '   ', 'Parent of '])).toEqual([]);
  });
});

describe('masking', () => {
  const m = nameMatcher(namesFromLabels(['Parent of Aarav Shah', 'Ayushi Kalal']));

  it('masks a known first name in prose', () => {
    expect(maskKnownNames('Please let Aarav leave early', m)).toBe('Please let «name» leave early');
  });

  it('masks the FULL name as one unit, never leaving the surname behind', () => {
    // Longest-first alternation. A half-masked name reads as a redaction that worked.
    expect(maskKnownNames('Regards, Ayushi Kalal', m)).toBe('Regards, «name»');
  });

  it('is case-insensitive', () => {
    expect(maskKnownNames('AARAV was absent', m)).toBe('«name» was absent');
  });

  it('does not match inside a longer word', () => {
    expect(maskKnownNames('The shahi paneer was cold', m)).toContain('shahi paneer');
  });

  it('leaves everything else untouched — including words redaction used to eat', () => {
    // The regex approach ate "Morker drop" out of a transport request; a dictionary cannot.
    const text = 'change the Morker drop services at Chandni Chowk';
    expect(maskKnownNames(text, m)).toBe(text);
  });

  it('returns null for an empty dictionary rather than a regex that matches everywhere', () => {
    expect(nameMatcher([])).toBeNull();
    expect(maskKnownNames('anything at all', null)).toBe('anything at all');
  });

  it('handles a large dictionary', () => {
    // Letter-only, because real names carry no digits and the extractor strips them.
    const alpha = (n: number) => 'Zz' + n.toString(36).replace(/\d/g, d => 'abcdefghij'[Number(d)]);
    const many = Array.from({ length: 3000 }, (_, i) => `Parent of ${alpha(i)}kar ${alpha(i)}wala`);
    const big = nameMatcher(namesFromLabels(many));
    expect(big).not.toBeNull();
    expect(maskKnownNames(`${alpha(42)}kar was absent`, big)).toBe('«name» was absent');
  });
});
