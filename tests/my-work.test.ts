// The "My work" stream (core/my-work.ts): one person's owned requests, bucketed exclusively.
// Pure tests only — no database, like all of core/.
//
// Fixture identities follow the synthetic-only rule: actor ids are NATO-set handles, and no
// name, phone or student id appears at all.
import { describe, it, expect } from 'vitest';
import { bucketMyWork, RESOLVED_WINDOW_DAYS, type MyWorkRow } from '../core/my-work';

const ME = 'staff-alpha-sample';
const OTHER = 'staff-bravo-sample';

const now = new Date('2026-07-07T10:00:00Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const at = (msFromNow: number) => new Date(+now + msFromNow);

let seq = 0;
const row = (over: Partial<MyWorkRow> = {}): MyWorkRow => ({
  id: `req-${++seq}`,
  ref: `FD-${String(seq).padStart(4, '0')}`,
  status: 'open',
  urgency: 'normal',
  ownerId: ME,
  aboutStaffIds: [],
  isSwitchboard: false,
  slaDueAt: at(3 * HOUR),
  ackDueAt: at(2 * HOUR), // default: open + unacknowledged → awaitingFirstLook
  acknowledgedAt: null,
  firstReplyAt: null,
  resolvedAt: null,
  ...over,
});

const bucketNames = ['awaitingFirstLook', 'openWork', 'waitingOnFamily', 'recentlyResolved'] as const;

/** One of every shape the stream can meet — the exclusivity property runs over all of them. */
const variedRows = (): MyWorkRow[] => [
  row(), // open, ack running → awaitingFirstLook
  row({ ackDueAt: at(-1 * HOUR) }), // open, ack overdue → awaitingFirstLook
  row({ acknowledgedAt: at(-1 * HOUR) }), // open, acknowledged → openWork
  row({ ackDueAt: null }), // open, never given an ack target → openWork
  row({ acknowledgedAt: at(-1 * HOUR), firstReplyAt: at(-1 * HOUR) }), // replied, still open
  row({ status: 'waiting' }),
  row({ status: 'waiting', acknowledgedAt: at(-2 * HOUR) }),
  row({ status: 'resolved', resolvedAt: at(-2 * DAY) }), // inside the window
  row({ status: 'resolved', resolvedAt: at(-8 * DAY) }), // beyond it → none
  row({ status: 'resolved', resolvedAt: null }), // no recorded instant → none
  row({ status: 'unfiled', ackDueAt: null }), // pre-filing → none
  row({ status: 'not_a_request' }), // parked → none
  row({ ownerId: OTHER }), // someone else's work → none
  row({ ownerId: null }), // unowned → none
  row({ aboutStaffIds: [ME] }), // about the actor → suppressed (QM-D33)
  row({ aboutStaffIds: [OTHER] }), // about someone ELSE, owned by actor → ordinary work
  row({ isSwitchboard: true }), // callback slip → still work
  row({ status: 'waiting', isSwitchboard: true }),
  row({ urgency: 'critical' }),
  row({ urgency: 'low', acknowledgedAt: at(-1 * HOUR), slaDueAt: null }),
];

describe('bucket exclusivity — a row lands in exactly one bucket, or none', () => {
  it('holds across the whole varied fixture set, and no row appears twice', () => {
    const rows = variedRows();
    const b = bucketMyWork(rows, ME, now);
    const all = bucketNames.flatMap(name => b[name]);
    expect(new Set(all.map(r => r.id)).size).toBe(all.length); // no duplicates anywhere
    for (const r of rows) {
      const memberships = bucketNames.filter(name => b[name].some(x => x.id === r.id)).length;
      expect(memberships, `${r.id} (status=${r.status})`).toBeLessThanOrEqual(1);
    }
  });

  it('places each shape where the ruling says', () => {
    const open = row();
    const acked = row({ acknowledgedAt: at(-1 * HOUR) });
    const noAckClock = row({ ackDueAt: null });
    const waiting = row({ status: 'waiting' });
    const closed = row({ status: 'resolved', resolvedAt: at(-1 * DAY) });
    const b = bucketMyWork([open, acked, noAckClock, waiting, closed], ME, now);
    expect(b.awaitingFirstLook.map(r => r.id)).toEqual([open.id]);
    expect(b.openWork.map(r => r.id).sort()).toEqual([acked.id, noAckClock.id].sort());
    expect(b.waitingOnFamily.map(r => r.id)).toEqual([waiting.id]);
    expect(b.recentlyResolved.map(r => r.id)).toEqual([closed.id]);
  });
});

describe('QM-D33 — a complaint about the actor never reaches their stream', () => {
  it('suppresses the row even when the actor owns it, whatever its status', () => {
    const rows = [
      row({ aboutStaffIds: [ME] }),
      row({ aboutStaffIds: [ME], status: 'waiting' }),
      row({ aboutStaffIds: [ME], status: 'resolved', resolvedAt: at(-1 * DAY) }),
    ];
    const b = bucketMyWork(rows, ME, now);
    for (const name of bucketNames) expect(b[name], name).toEqual([]);
  });

  it('the actor amid several named staff is still excluded', () => {
    const b = bucketMyWork([row({ aboutStaffIds: [OTHER, ME] })], ME, now);
    for (const name of bucketNames) expect(b[name], name).toEqual([]);
  });

  it('a complaint about someone ELSE, owned by the actor, flows through as ordinary work (QM-D32)', () => {
    const r = row({ aboutStaffIds: [OTHER] });
    const b = bucketMyWork([r], ME, now);
    expect(b.awaitingFirstLook.map(x => x.id)).toEqual([r.id]);
  });
});

describe('sort orders', () => {
  it('awaitingFirstLook sorts most-overdue first, still-due last', () => {
    const lateThree = row({ ackDueAt: at(-3 * HOUR) });
    const stillDue = row({ ackDueAt: at(1 * HOUR) });
    const lateFive = row({ ackDueAt: at(-5 * HOUR) });
    const b = bucketMyWork([lateThree, stillDue, lateFive], ME, now);
    expect(b.awaitingFirstLook.map(r => r.id)).toEqual([lateFive.id, lateThree.id, stillDue.id]);
  });

  it('openWork sorts by urgency rank, then slaDueAt ascending, no-target last', () => {
    const acked = { acknowledgedAt: at(-1 * HOUR) };
    const lowSoon = row({ ...acked, urgency: 'low', slaDueAt: at(1 * HOUR) });
    const criticalFar = row({ ...acked, urgency: 'critical', slaDueAt: at(9 * HOUR) });
    const normalNoTarget = row({ ...acked, urgency: 'normal', slaDueAt: null });
    const normalSoon = row({ ...acked, urgency: 'normal', slaDueAt: at(1 * HOUR) });
    const b = bucketMyWork([lowSoon, criticalFar, normalNoTarget, normalSoon], ME, now);
    expect(b.openWork.map(r => r.id)).toEqual([
      criticalFar.id, // urgency beats target proximity
      normalSoon.id,
      normalNoTarget.id, // no target sorts after a dated one within the same urgency
      lowSoon.id,
    ]);
  });

  it('recentlyResolved sorts newest closure first', () => {
    const older = row({ status: 'resolved', resolvedAt: at(-5 * DAY) });
    const newer = row({ status: 'resolved', resolvedAt: at(-1 * DAY) });
    const b = bucketMyWork([older, newer], ME, now);
    expect(b.recentlyResolved.map(r => r.id)).toEqual([newer.id, older.id]);
  });
});

describe('the seven-day resolution window', () => {
  it('resolved exactly seven days ago is still on the stream (inclusive boundary)', () => {
    const r = row({ status: 'resolved', resolvedAt: at(-RESOLVED_WINDOW_DAYS * DAY) });
    expect(bucketMyWork([r], ME, now).recentlyResolved.map(x => x.id)).toEqual([r.id]);
  });

  it('one millisecond beyond the window drops off', () => {
    const r = row({ status: 'resolved', resolvedAt: at(-RESOLVED_WINDOW_DAYS * DAY - 1) });
    const b = bucketMyWork([r], ME, now);
    for (const name of bucketNames) expect(b[name], name).toEqual([]);
  });
});

describe('what counts as work', () => {
  it('switchboard rows are included as ordinary work, not a separate pile', () => {
    const slip = row({ isSwitchboard: true, acknowledgedAt: at(-1 * HOUR) });
    const waitingSlip = row({ isSwitchboard: true, status: 'waiting' });
    const b = bucketMyWork([slip, waitingSlip], ME, now);
    expect(b.openWork.map(r => r.id)).toEqual([slip.id]);
    expect(b.waitingOnFamily.map(r => r.id)).toEqual([waitingSlip.id]);
  });

  it('unowned rows and other people\'s rows never appear', () => {
    const b = bucketMyWork([row({ ownerId: null }), row({ ownerId: OTHER })], ME, now);
    for (const name of bucketNames) expect(b[name], name).toEqual([]);
  });

  it('resolved older than the window and pre-filing rows never appear', () => {
    const rows = [
      row({ status: 'resolved', resolvedAt: at(-30 * DAY) }),
      row({ status: 'unfiled', ackDueAt: null }),
      row({ status: 'not_a_request' }),
    ];
    const b = bucketMyWork(rows, ME, now);
    for (const name of bucketNames) expect(b[name], name).toEqual([]);
  });
});
