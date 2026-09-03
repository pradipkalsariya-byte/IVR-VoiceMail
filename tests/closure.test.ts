import { describe, it, expect } from 'vitest';
import { closureVerdict, SATISFACTION_ABSENT_REASONS, isAbsentReason } from '../core/closure';
import { listProjection } from '../core/permissions';

// ------------------------------------------------------------------ QM-D18: the closure gate
describe('closureVerdict — closing needs a rating OR a coded absence reason', () => {
  const base = { isSwitchboard: false };

  it('accepts a rating 1..5, records no absence reason', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const v = closureVerdict({ ...base, satisfaction: n, absentReason: null });
      expect(v).toEqual({ ok: true, satisfaction: n, absentReason: null });
    }
  });

  it('accepts each coded reason when there is no rating', () => {
    for (const r of SATISFACTION_ABSENT_REASONS) {
      const v = closureVerdict({ ...base, satisfaction: null, absentReason: r.key });
      expect(v).toEqual({ ok: true, satisfaction: null, absentReason: r.key });
    }
  });

  it('refuses neither — with a reason a person can read', () => {
    const v = closureVerdict({ ...base, satisfaction: null, absentReason: null });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('QM-D18');
  });

  it('refuses BOTH a rating and an absence reason — never silently prefers one', () => {
    const v = closureVerdict({ ...base, satisfaction: 4, absentReason: 'asked_no_reply' });
    expect(v.ok).toBe(false);
  });

  it('refuses out-of-range and non-integer ratings', () => {
    for (const bad of [0, 6, -1, 2.5, NaN]) {
      expect(closureVerdict({ ...base, satisfaction: bad, absentReason: null }).ok).toBe(false);
    }
  });

  it('refuses a reason not on the coded list', () => {
    const v = closureVerdict({ ...base, satisfaction: null, absentReason: 'they seemed fine' });
    expect(v.ok).toBe(false);
    expect(isAbsentReason('they seemed fine')).toBe(false);
  });

  it('a switchboard slip closes without the leg — nobody complained, nobody to ask', () => {
    const v = closureVerdict({ satisfaction: null, absentReason: null, isSwitchboard: true });
    expect(v).toEqual({ ok: true, satisfaction: null, absentReason: null });
  });

  it('never_asked is the only value flagged as OUR process failure', () => {
    const failures = SATISFACTION_ABSENT_REASONS.filter(r => r.processFailure).map(r => r.key);
    expect(failures).toEqual(['never_asked']);
  });
});

// -------------------------------------------------- safeguarding masking on LIST surfaces
describe('listProjection — a list row is the widest surface, so it carries the least', () => {
  const fsk = 'ou-fsk';
  const req = (isSafeguarding: boolean) => ({
    isSafeguarding, campusOrgUnitId: fsk,
    subject: 'Child left at the bus stop', body: 'Named detail about a specific child.',
  });
  const desk = { permissions: ['view_queue', 'file', 'resolve'], scopeOrgUnitId: fsk, isVendor: false };
  const safeguardingLead = { permissions: ['view_queue', 'view_safeguarding'], scopeOrgUnitId: fsk, isVendor: false };
  const oversightOnly = { permissions: ['oversight'], scopeOrgUnitId: 'ou-group', isVendor: false };

  it('an ordinary request passes through untouched', () => {
    expect(listProjection(desk, req(false)).masked).toBe(false);
  });

  it('masks subject AND preview from campus staff without the named grant', () => {
    const p = listProjection(desk, req(true));
    expect(p.masked).toBe(true);
    expect(p.subject).not.toContain('bus stop');
    expect(p.preview).not.toContain('child');
  });

  it('oversight does NOT imply the safeguarding grant — masked for leadership too', () => {
    expect(listProjection(oversightOnly, req(true)).masked).toBe(true);
  });

  it('the named grant sees the real subject', () => {
    const p = listProjection(safeguardingLead, req(true));
    expect(p.masked).toBe(false);
    expect(p.subject).toBe('Child left at the bus stop');
  });

  it('keeps the ROW, masks the CONTENT — a hidden row would let the case sit unworked', () => {
    const p = listProjection(desk, req(true));
    expect(p.subject.length).toBeGreaterThan(0); // something renders; the work is visible
  });
});
