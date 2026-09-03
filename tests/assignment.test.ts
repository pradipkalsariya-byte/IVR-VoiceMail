// Feedback #18 (routing), #20 (escalation), #21 (roster) — they only make sense together.
import { describe, it, expect } from 'vitest';
import {
  chooseOwner, shouldEscalate, rotate, ESCALATE_AFTER_HOURS,
  type Candidate, type AssignmentInput,
} from '../core/assignment';

const NOW = new Date('2026-08-26T10:00:00Z');
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600000);

const who = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, name: id, scopeOrgUnitId: 'fsk',
  permissions: ['view_queue', 'file', 'assign', 'resolve'], awayUntil: null, ...over,
});

const input = (over: Partial<AssignmentInput> = {}): AssignmentInput => ({
  campusOrgUnitId: 'fsk', category: 'transport',
  onDutyIds: ['a'], routes: new Map([['transport', 'a']]),
  candidates: [who('a'), who('b')], aboutStaffIds: [], now: NOW, ...over,
});

describe('choosing an owner', () => {
  it('prefers the routed specialist when they are on duty', () => {
    const d = chooseOwner(input());
    expect(d.ownerId).toBe('a');
    expect(d.reason).toMatch(/handles transport/);
  });

  it('covers with whoever IS on duty when the specialist is not', () => {
    // Cover beats expertise: an owner who is present beats the right owner who is absent.
    const d = chooseOwner(input({ onDutyIds: ['b'] }));
    expect(d.ownerId).toBe('b');
    expect(d.reason).toMatch(/not on duty today/);
  });

  it('says the specialist is AWAY when that is the reason, not just off-duty', () => {
    const d = chooseOwner(input({
      onDutyIds: ['a', 'b'],
      candidates: [who('a', { awayUntil: new Date('2026-09-01T00:00:00Z') }), who('b')],
    }));
    expect(d.ownerId).toBe('b');
    expect(d.reason).toMatch(/is away/);
  });

  it('never assigns to someone the request is ABOUT', () => {
    const d = chooseOwner(input({ aboutStaffIds: ['a'], onDutyIds: ['a', 'b'] }));
    expect(d.ownerId).toBe('b');
  });

  it('never assigns outside the campus', () => {
    const d = chooseOwner(input({
      onDutyIds: ['a', 'b'],
      candidates: [who('a', { scopeOrgUnitId: 'fwgs' }), who('b')],
    }));
    expect(d.ownerId).toBe('b');
  });

  it('assigns group-scoped people anywhere', () => {
    const d = chooseOwner(input({
      onDutyIds: ['g'], routes: new Map(),
      candidates: [who('g', { scopeOrgUnitId: 'group' })],
    }));
    expect(d.ownerId).toBe('g');
  });

  it('skips someone who cannot resolve — a view-only grant is not an owner', () => {
    const d = chooseOwner(input({
      onDutyIds: ['v', 'b'], routes: new Map(),
      candidates: [who('v', { permissions: ['view_queue'] }), who('b')],
    }));
    expect(d.ownerId).toBe('b');
  });

  it('falls back to anyone available when NO roster exists for today', () => {
    // An empty roster is a real state — the desk may not have filled it in — not an error.
    const d = chooseOwner(input({ onDutyIds: [] }));
    expect(d.ownerId).toBe('a');
    expect(d.reason).toMatch(/Nobody is rostered/);
  });

  it('returns NOBODY, with a reason, rather than a plausible owner who cannot act', () => {
    const d = chooseOwner(input({ onDutyIds: [], candidates: [] }));
    expect(d.ownerId).toBeNull();
    expect(d.reason).toMatch(/nobody else is available/);
  });

  it('handles an uncategorised request without inventing a route', () => {
    const d = chooseOwner(input({ category: null, onDutyIds: ['b'], routes: new Map() }));
    expect(d.ownerId).toBe('b');
    expect(d.reason).toMatch(/no category yet/);
  });

  it('always gives a reason, assigned or not', () => {
    for (const d of [chooseOwner(input()), chooseOwner(input({ onDutyIds: [], candidates: [] }))]) {
      expect(d.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('escalation', () => {
  const esc = (over = {}) => shouldEscalate({
    ownerId: 'a', ownerSetAt: hoursAgo(1), firstReplyAt: null,
    urgency: 'normal', owner: who('a'), now: NOW, ...over,
  });

  it('does not escalate an unowned request — there is nothing to escalate from', () => {
    expect(esc({ ownerId: null }).escalate).toBe(false);
  });

  it('does not escalate once the family has been replied to', () => {
    expect(esc({ ownerSetAt: hoursAgo(100), firstReplyAt: hoursAgo(1) }).escalate).toBe(false);
  });

  it('escalates IMMEDIATELY when the owner is marked away', () => {
    const d = esc({ owner: who('a', { awayUntil: new Date('2026-09-01T00:00:00Z') }) });
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/marked away/);
  });

  it('escalates on the timer when nobody set a flag', () => {
    // The case that will actually fire most: nobody marks themselves away on the morning they
    // wake up ill, which is the morning their queue needs covering.
    const d = esc({ ownerSetAt: hoursAgo(30) });
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/30 hours ago/);
  });

  it('scales the timer by urgency — a critical item does not get a day', () => {
    expect(ESCALATE_AFTER_HOURS.critical).toBeLessThan(ESCALATE_AFTER_HOURS.normal);
    expect(esc({ urgency: 'critical', ownerSetAt: hoursAgo(3) }).escalate).toBe(true);
    expect(esc({ urgency: 'normal', ownerSetAt: hoursAgo(3) }).escalate).toBe(false);
  });

  it('does not act when it does not know WHEN the owner took it on', () => {
    // Older records predate the tracking. Acting on an unknown would churn historical work.
    expect(esc({ ownerSetAt: null }).escalate).toBe(false);
  });

  it('explains how much time is left when it does not escalate', () => {
    expect(esc({ ownerSetAt: hoursAgo(2) }).reason).toMatch(/2 of the 24 hours/);
  });
});

describe('roster rotation', () => {
  it('rotates people across days', () => {
    expect(rotate(['a', 'b', 'c'], 5)).toEqual([['a'], ['b'], ['c'], ['a'], ['b']]);
  });

  it('is DETERMINISTIC — regenerating the same fortnight gives the same roster', () => {
    // A generator that shuffled would silently rewrite a roster someone arranged their week around.
    expect(rotate(['a', 'b', 'c'], 14)).toEqual(rotate(['a', 'b', 'c'], 14));
  });

  it('can put more than one person on a day', () => {
    expect(rotate(['a', 'b', 'c'], 2, 2)).toEqual([['a', 'b'], ['c', 'a']]);
  });

  it('never puts the same person on a day twice when the team is smaller than perDay', () => {
    expect(rotate(['a'], 1, 3)).toEqual([['a']]);
  });

  it('returns nothing for an empty team rather than throwing', () => {
    expect(rotate([], 5)).toEqual([]);
    expect(rotate(['a'], 0)).toEqual([]);
  });
});
