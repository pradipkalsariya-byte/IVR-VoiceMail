// tests/bridge.test.ts — the parent-app bridge's pure half (core/bridge.ts).
//
// The mapping test doubles as the drift guard between the two apps' vocabularies: the literal
// strings nucleus-parent's routing menu sends ("Records & documents", "Complaint") must keep
// landing on real taxonomy keys here. If either side renames, this is the test that says so.

import { describe, expect, it } from 'vitest';
import { mapBridgeCategory, parseBridgeEvent, parseBridgeIntake, secretMatches } from '@/core/bridge';
import { CATEGORY_KEYS } from '@/core/taxonomy';

describe('secretMatches', () => {
  it('refuses when either side is missing — an unconfigured bridge does not exist', () => {
    expect(secretMatches(undefined, 'x')).toBe(false);
    expect(secretMatches('x', null)).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });
  it('accepts only an exact match', () => {
    expect(secretMatches('local-demo', 'local-demo')).toBe(true);
    expect(secretMatches('local-demo', 'local-demO')).toBe(false);
    expect(secretMatches('local-demo', 'local-dem')).toBe(false);
  });
});

describe('mapBridgeCategory — the vocabulary seam', () => {
  it('maps the parent app’s menu strings onto real taxonomy keys', () => {
    expect(mapBridgeCategory('Records & documents')).toBe('certificates');
    expect(mapBridgeCategory('Complaint')).toBe('unclassified');
  });
  it('every mapped value is a key the taxonomy actually has', () => {
    for (const v of [mapBridgeCategory('Records & documents'), mapBridgeCategory('Complaint')]) {
      expect(CATEGORY_KEYS).toContain(v);
    }
  });
  it('passes a genuine taxonomy key through, so the parent app can adopt the full menu later', () => {
    expect(mapBridgeCategory('transport')).toBe('transport');
  });
  it('falls to unclassified — never a guess — for null or junk', () => {
    expect(mapBridgeCategory(null)).toBe('unclassified');
    expect(mapBridgeCategory('Something new the menu invented')).toBe('unclassified');
  });
});

describe('parseBridgeIntake', () => {
  const good = {
    familyLabel: 'Mehta family',
    familyEmailKey: 'Parent@Example.com',
    campus: 'FSK',
    category: 'Complaint',
    subject: 'The bus was 40 minutes late',
    body: 'Three days running now.',
  };
  it('accepts a full payload and normalises email + campus to lowercase', () => {
    const r = parseBridgeIntake(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.familyEmailKey).toBe('parent@example.com');
      expect(r.value.campus).toBe('fsk');
      expect(r.value.grade).toBeNull();
    }
  });
  it.each([
    ['familyLabel', { ...good, familyLabel: ' ' }],
    ['familyEmailKey', { ...good, familyEmailKey: 'not-an-email' }],
    ['campus', { ...good, campus: '' }],
    ['subject', { ...good, subject: '' }],
    ['body', { ...good, body: '  ' }],
  ])('refuses a payload with a bad %s, with a reason', (_field, payload) => {
    const r = parseBridgeIntake(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
  it('refuses a non-object body', () => {
    expect(parseBridgeIntake(null).ok).toBe(false);
    expect(parseBridgeIntake('{}').ok).toBe(false);
  });
});

describe('parseBridgeEvent', () => {
  it('accepts the three event kinds', () => {
    expect(parseBridgeEvent({ kind: 'message', body: 'Any update?' })).toEqual({
      ok: true, value: { kind: 'message', body: 'Any update?' },
    });
    expect(parseBridgeEvent({ kind: 'rating', rating: 4 })).toEqual({
      ok: true, value: { kind: 'rating', rating: 4 },
    });
    expect(parseBridgeEvent({ kind: 'escalation' })).toEqual({ ok: true, value: { kind: 'escalation' } });
  });
  it('refuses an empty message, an out-of-range or fractional rating, and an unknown kind', () => {
    expect(parseBridgeEvent({ kind: 'message', body: ' ' }).ok).toBe(false);
    expect(parseBridgeEvent({ kind: 'rating', rating: 0 }).ok).toBe(false);
    expect(parseBridgeEvent({ kind: 'rating', rating: 6 }).ok).toBe(false);
    expect(parseBridgeEvent({ kind: 'rating', rating: 3.5 }).ok).toBe(false);
    expect(parseBridgeEvent({ kind: 'delete' }).ok).toBe(false);
  });
});
