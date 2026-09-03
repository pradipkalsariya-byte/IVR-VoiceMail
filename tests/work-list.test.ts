// The contributed row and the claimable pool (core/work-list.ts): QM-D29's seven-field wire
// shape, QM-D30's suppress-never-sanitise rule, QM-D31's pool selection, and the pure half
// of the claim-race refusal. Pure tests only — no database, like all of core/.
//
// Fixture identities follow the synthetic-only rule: NATO-set handles, no name, phone or
// student id appears at all.
import { describe, it, expect } from 'vitest';
import {
  CLAIM_RACE_REASON,
  claimDecision,
  contributedRow,
  poolItems,
  type ContributableRequest,
  type PoolCandidate,
} from '../core/work-list';

const ME = 'staff-alpha-sample';
const OTHER = 'staff-bravo-sample';

const now = new Date('2026-07-07T10:00:00Z');
const HOUR = 3_600_000;
const at = (msFromNow: number) => new Date(+now + msFromNow);

const req = (over: Partial<ContributableRequest> = {}): ContributableRequest => ({
  ref: 'FD-0042',
  subject: 'Bus stop change for the Sample family',
  urgency: 'high',
  category: 'transport',
  slaDueAt: at(3 * HOUR),
  isSafeguarding: false,
  ownerName: 'Bravo Sample',
  ...over,
});

describe('QM-D29 — the contributed row is exactly seven fields', () => {
  it('carries the seven ruled fields and not one more', () => {
    const row = contributedRow(req());
    expect(row).not.toBeNull();
    // The ruling ENUMERATES seven. An eighth field added later must fail here, loudly —
    // the wire shape is the contract, not a starting point.
    expect(Object.keys(row!).length).toBe(7);
    expect(row).toEqual({
      module: 'front-desk',
      ref: 'FD-0042',
      title: 'Bus stop change for the Sample family',
      ownerName: 'Bravo Sample',
      dueTarget: at(3 * HOUR),
      priority: 'high',
      itemType: 'transport',
    });
  });

  it('a caller handing over a WHOLE request still gets only the seven (a Prisma row is a superset)', () => {
    // The narrative, the detail, the audience list — still excluded even when the input
    // carries them: the row builder picks its seven, it never spreads.
    const whole = {
      ...req(),
      body: 'the full narrative, which never goes on the wire',
      aboutStaffIds: [OTHER],
      satisfaction: 2,
      isSwitchboard: false,
    };
    const row = contributedRow(whole as ContributableRequest)!;
    expect(Object.keys(row).length).toBe(7);
    expect(JSON.stringify(row)).not.toContain('narrative');
  });

  it('dueTarget passes through as the queue target the item inherits (QM-D31)', () => {
    expect(contributedRow(req({ slaDueAt: at(5 * HOUR) }))!.dueTarget).toEqual(at(5 * HOUR));
    expect(contributedRow(req({ slaDueAt: null }))!.dueTarget).toBeNull();
  });

  it('priority mirrors urgency verbatim', () => {
    for (const u of ['low', 'normal', 'high', 'critical']) {
      expect(contributedRow(req({ urgency: u }))!.priority).toBe(u);
    }
  });

  it('itemType mirrors the category; untriaged stays null rather than inventing a tag', () => {
    expect(contributedRow(req({ category: 'fees' }))!.itemType).toBe('fees');
    expect(contributedRow(req({ category: null }))!.itemType).toBeNull();
  });

  it('an unowned item carries ownerName null — a present field, not a missing key', () => {
    const row = contributedRow(req({ ownerName: null }))!;
    expect(row.ownerName).toBeNull();
    expect('ownerName' in row).toBe(true);
    expect(Object.keys(row).length).toBe(7);
  });
});

describe('QM-D30 — a safeguarding flag suppresses the row, never sanitises the title', () => {
  it('returns null for a safeguarding request', () => {
    expect(contributedRow(req({ isSafeguarding: true }))).toBeNull();
  });

  it('null, NOT a masked object — no "named access only" placeholder exists on this surface (R3-19)', () => {
    // Contrast listProjection (core/permissions.ts), which masks but KEEPS the queue row:
    // a queue is worked by the grant-holding desk. The contributed row goes to the widest
    // surface in the estate, where a placeholder title would itself announce the case.
    const out = contributedRow(req({ isSafeguarding: true, subject: 'anything at all' }));
    expect(out).toBeNull();
    expect(out).not.toEqual(expect.objectContaining({ title: expect.anything() }));
  });
});

let seq = 0;
const cand = (over: Partial<PoolCandidate & { id: string }> = {}) => ({
  id: `req-${++seq}`,
  status: 'open',
  urgency: 'normal',
  ownerId: null as string | null,
  aboutStaffIds: [] as string[],
  slaDueAt: at(3 * HOUR) as Date | null,
  ...over,
});

describe('QM-D31 — the claimable pool selects live unowned queue items', () => {
  it('keeps open|waiting unowned rows; drops owned, closed, pre-queue and about-actor rows', () => {
    const keepOpen = cand();
    const keepWaiting = cand({ status: 'waiting' });
    const ownedByOther = cand({ ownerId: OTHER }); // someone's personal item
    const ownedByMe = cand({ ownerId: ME }); // MY personal item — the buckets' business
    const resolved = cand({ status: 'resolved' });
    const unfiled = cand({ status: 'unfiled' }); // not yet a queue item at all
    const parked = cand({ status: 'not_a_request' });
    const aboutMe = cand({ aboutStaffIds: [ME] }); // closed to me (QM-D33)
    const out = poolItems(
      [keepOpen, keepWaiting, ownedByOther, ownedByMe, resolved, unfiled, parked, aboutMe],
      ME,
    );
    expect(out.map(r => r.id).sort()).toEqual([keepOpen.id, keepWaiting.id].sort());
  });

  it('a row about someone ELSE is claimable by me — QM-D33 excludes only the named person', () => {
    const r = cand({ aboutStaffIds: [OTHER] });
    expect(poolItems([r], ME).map(x => x.id)).toEqual([r.id]);
  });

  it('orders like the working queue: urgency rank, then the inherited target, no-target last', () => {
    const lowSoon = cand({ urgency: 'low', slaDueAt: at(1 * HOUR) });
    const criticalFar = cand({ urgency: 'critical', slaDueAt: at(9 * HOUR) });
    const normalNoTarget = cand({ urgency: 'normal', slaDueAt: null });
    const normalSoon = cand({ urgency: 'normal', slaDueAt: at(1 * HOUR) });
    const out = poolItems([lowSoon, criticalFar, normalNoTarget, normalSoon], ME);
    expect(out.map(r => r.id)).toEqual([
      criticalFar.id, // urgency beats target proximity
      normalSoon.id,
      normalNoTarget.id, // no target sorts after a dated one within the same urgency
      lowSoon.id,
    ]);
  });

  it('richer rows pass through unchanged — the generic keeps the page row intact', () => {
    const r = { ...cand(), extra: 'kept' };
    expect(poolItems([r], ME)[0].extra).toBe('kept');
  });
});

describe('the claim decision — the pure half of the race protection', () => {
  it('refuses an already-owned row with the exact race message the pool shows', () => {
    const d = claimDecision({ status: 'open', ownerId: OTHER });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe(CLAIM_RACE_REASON);
    expect(CLAIM_RACE_REASON).toBe('Someone claimed this first — the pool moved under you.');
  });

  it('refuses a non-live status with a reason naming the status', () => {
    for (const status of ['unfiled', 'resolved', 'not_a_request']) {
      const d = claimDecision({ status, ownerId: null });
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain(status);
    }
  });

  it('allows an unowned live row, with a reason (never a bare true)', () => {
    for (const status of ['open', 'waiting']) {
      const d = claimDecision({ status, ownerId: null });
      expect(d.allowed).toBe(true);
      expect(d.reason).not.toBe('');
    }
  });
});
