import { describe, it, expect } from 'vitest';
import { CHASE_COOLDOWN_WORKING_HOURS, chaseTitle, chasesOwed, type ChaseableRow } from '../core/chase';

// Thursday 2026-08-06, 14:30 IST — a working day, inside desk hours, so the cooldown
// arithmetic below stays readable.
const NOW = new Date('2026-08-06T09:00:00Z');

const row = (over: Partial<ChaseableRow> = {}): ChaseableRow => ({
  id: 'r1',
  ref: 'FD-0142',
  status: 'open',
  slaDueAt: new Date('2026-08-06T07:00:00Z'), // 12:30 IST — two hours past at NOW
  firstReplyAt: null,
  ...over,
});

const none = new Map<string, Date>();

describe('chasesOwed — derived from the breached response clock (QM-D14, QM-D15)', () => {
  it('owes a chase for a breached, open, never-chased request', () => {
    const owed = chasesOwed([row()], none, NOW);
    expect(owed).toHaveLength(1);
    expect(owed[0]).toMatchObject({ id: 'r1', ref: 'FD-0142' });
    expect(owed[0].lateMs).toBe(2 * 60 * 60_000);
  });

  it('fires on the RESPONSE breach only — a clock still ahead means no chase', () => {
    // QM-D14 consequence 3: never on a missed acknowledgement. The signature enforces the
    // rest: ChaseableRow carries no ack fields at all, so an ack-overdue item with response
    // margin left simply has nothing here to make it owed.
    const owed = chasesOwed([row({ slaDueAt: new Date('2026-08-06T11:00:00Z') })], none, NOW);
    expect(owed).toEqual([]);
  });

  it('never chases an answered request — a first reply stops the response clock', () => {
    const owed = chasesOwed(
      [row({ status: 'waiting', firstReplyAt: new Date('2026-08-06T08:00:00Z') })],
      none, NOW,
    );
    expect(owed).toEqual([]);
  });

  it('includes waiting, excludes resolved / not_a_request / unfiled', () => {
    const rows = [
      row({ id: 'a', ref: 'FD-0001', status: 'waiting' }),
      row({ id: 'b', ref: 'FD-0002', status: 'resolved' }),
      row({ id: 'c', ref: 'FD-0003', status: 'not_a_request' }),
      // An unfiled item's response clock is already running and CAN breach — but there is no
      // owner to find until someone files it; its remedy is filing, not chasing.
      row({ id: 'd', ref: 'FD-0004', status: 'unfiled' }),
    ];
    expect(chasesOwed(rows, none, NOW).map(o => o.id)).toEqual(['a']);
  });

  it('gives no chase to a request with no response target at all', () => {
    expect(chasesOwed([row({ slaDueAt: null })], none, NOW)).toEqual([]);
  });

  it('suppresses a request chased within the cooldown window', () => {
    // Chased at 13:30 IST today; +4 working hours crosses the 17:00 close and lands on
    // Friday morning — well after NOW, so the desk is not nagged again yet.
    const last = new Map([['r1', new Date('2026-08-06T08:00:00Z')]]);
    expect(chasesOwed([row()], last, NOW)).toEqual([]);
  });

  it('owes again once the cooldown has fully elapsed in working hours', () => {
    // Chased Wednesday 11:00 IST; +4 working hours = Wednesday 15:00 IST, before NOW.
    const last = new Map([['r1', new Date('2026-08-05T05:30:00Z')]]);
    expect(chasesOwed([row()], last, NOW)).toHaveLength(1);
  });

  it('sorts most-overdue first — the family waiting longest is chased first', () => {
    const rows = [
      row({ id: 'newer', ref: 'FD-0201' }), // 2h late
      row({ id: 'older', ref: 'FD-0200', slaDueAt: new Date('2026-08-05T07:00:00Z') }), // 26h late
    ];
    expect(chasesOwed(rows, none, NOW).map(o => o.id)).toEqual(['older', 'newer']);
  });

  it('cooldown is a seed value, config in the real module', () => {
    expect(CHASE_COOLDOWN_WORKING_HOURS).toBeGreaterThan(0);
  });
});

describe('chaseTitle — reference-only by signature (HDT-9)', () => {
  it('says exactly what a chase is allowed to say', () => {
    expect(chaseTitle('FD-0142')).toBe('FD-0142 is overdue — find its owner');
  });

  it('takes ONLY the ref — a subject cannot even be passed', () => {
    // The constraint is enforced by the type; this pins the arity so a future "helpful"
    // second parameter (a subject, a family label) fails a test, not just a review.
    expect(chaseTitle.length).toBe(1);
  });

  it('never carries the narrative: the output contains only the reference given', () => {
    const title = chaseTitle('FD-0007');
    expect(title).toContain('FD-0007');
    expect(title).not.toMatch(/subject|family|child|complaint/i);
  });
});
