// Feedback #6 (age limit) and #8 (switchboard leaves the queue), from the 26-Aug-2026 review.
import { describe, it, expect } from 'vitest';
import {
  RECORDS_BEGIN_AT, queueWindowStart, withinQueueWindow, belongsInQueue,
  belongsInSwitchboard, agedOutCount, type QueueCandidate,
} from '../core/queue-window';

const NOW = new Date('2026-08-26T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

const item = (over: Partial<QueueCandidate> = {}): QueueCandidate => ({
  arrivedAt: daysAgo(1), status: 'unfiled', ownerId: null, isSwitchboard: false, ...over,
});

describe('the age limit (feedback #6)', () => {
  it('keeps a recent unfiled item', () => {
    expect(withinQueueWindow(item({ arrivedAt: daysAgo(3) }), NOW)).toBe(true);
  });

  it('drops an unfiled item older than the window', () => {
    expect(withinQueueWindow(item({ arrivedAt: new Date('2020-08-10T00:00:00Z') }), NOW)).toBe(false);
  });

  it('KEEPS an old item that has been filed — ageing out live work would be the bug', () => {
    expect(withinQueueWindow(item({ arrivedAt: new Date('2020-08-10T00:00:00Z'), status: 'open' }), NOW)).toBe(true);
    expect(withinQueueWindow(item({ arrivedAt: new Date('2020-08-10T00:00:00Z'), status: 'waiting' }), NOW)).toBe(true);
  });

  it('KEEPS an old unfiled item that somebody owns', () => {
    // Claimed but not yet filed: still somebody's work, so it cannot disappear underneath them.
    expect(withinQueueWindow(item({ arrivedAt: new Date('2020-08-10T00:00:00Z'), ownerId: 'staff-1' }), NOW)).toBe(true);
  });

  it('treats the boundary as inclusive, and one second before it as out', () => {
    const edge = queueWindowStart();
    expect(withinQueueWindow(item({ arrivedAt: edge }), NOW)).toBe(true);
    expect(withinQueueWindow(item({ arrivedAt: new Date(edge.getTime() - 1000) }), NOW)).toBe(false);
  });

  it('starts at 01-Aug-2026 IST, which is 31-Jul 18:30 UTC', () => {
    // The timezone matters: cutting at 2026-08-01T00:00Z would strand 5.5 hours of real
    // 1st-August IST mail on the wrong side of the line.
    expect(RECORDS_BEGIN_AT.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(withinQueueWindow(item({ arrivedAt: new Date('2026-08-01T03:00:00+05:30') }), NOW)).toBe(true);
    expect(withinQueueWindow(item({ arrivedAt: new Date('2026-07-31T23:00:00+05:30') }), NOW)).toBe(false);
  });

  it('is a FIXED line, not a rolling window — it does not move as time passes', () => {
    // A rolling window would keep dropping August as September arrives, losing exactly the
    // period the desk is meant to be working.
    const augustItem = item({ arrivedAt: new Date('2026-08-05T06:00:00Z') });
    expect(withinQueueWindow(augustItem, new Date('2026-09-30T00:00:00Z'))).toBe(true);
    expect(withinQueueWindow(augustItem, new Date('2027-06-30T00:00:00Z'))).toBe(true);
  });
});

describe('switchboard slips leave the queue (feedback #8)', () => {
  it('excludes a switchboard slip however recent', () => {
    expect(belongsInQueue(item({ isSwitchboard: true, arrivedAt: NOW }), NOW)).toBe(false);
  });

  it('excludes it even when filed and owned — it is never queue work', () => {
    const worked = item({ isSwitchboard: true, status: 'open', ownerId: 'staff-1' });
    expect(belongsInQueue(worked, NOW)).toBe(false);
  });

  it('claims exactly what the queue rejects — the two views must not overlap or leak', () => {
    const rows = [
      item({ isSwitchboard: true }),
      item({ isSwitchboard: false }),
      item({ isSwitchboard: true, arrivedAt: new Date('2020-08-10T00:00:00Z') }),
      item({ isSwitchboard: false, arrivedAt: new Date('2020-08-10T00:00:00Z'), status: 'open' }),
    ];
    for (const r of rows) {
      // Every row lands in exactly one of the two surfaces, or is aged out of both by #6.
      const inQueue = belongsInQueue(r, NOW);
      const inSwitchboard = belongsInSwitchboard(r);
      expect(inQueue && inSwitchboard).toBe(false);
      if (r.isSwitchboard) expect(inSwitchboard).toBe(true);
    }
  });
});

describe('nothing disappears silently', () => {
  it('counts what the age limit is holding back, so the page can say so', () => {
    const rows = [
      item({ arrivedAt: daysAgo(2) }),
      item({ arrivedAt: new Date('2026-05-01T00:00:00Z') }),
      item({ arrivedAt: new Date('2020-08-10T00:00:00Z') }),
      item({ arrivedAt: new Date('2020-08-10T00:00:00Z'), status: 'open' }),   // kept, not counted
      item({ arrivedAt: new Date('2020-08-10T00:00:00Z'), isSwitchboard: true }), // switchboard's, not the queue's
    ];
    expect(agedOutCount(rows, NOW)).toBe(2);
  });

  it('counts zero when everything is recent', () => {
    expect(agedOutCount([item(), item()], NOW)).toBe(0);
  });
});
