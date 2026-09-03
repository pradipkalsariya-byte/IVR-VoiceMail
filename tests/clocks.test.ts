// The two clocks: acknowledgement-target arithmetic (core/sla.ts, QM-D12) and the read-time
// derivation (core/clocks.ts, QM-D15). Pure tests only — no database, like all of core/.
import { describe, it, expect } from 'vitest';
import { ackDueFrom, ACK_TARGET_WORKING_HOURS, DEFAULT_DESK } from '../core/sla';
import { readClocks, type ClockableRequest, type ClockState } from '../core/clocks';

// All fixtures are UTC. IST is UTC+5:30, so 02:30Z = 08:00 IST (desk open).
const utc = (iso: string) => new Date(iso);
const ist = (d: Date) => new Date(+d + 330 * 60_000);
const istHM = (d: Date) => `${String(ist(d).getUTCHours()).padStart(2, '0')}:${String(ist(d).getUTCMinutes()).padStart(2, '0')}`;

const HOUR = 3_600_000;

const blank: ClockableRequest = {
  status: 'open',
  slaDueAt: null,
  ackDueAt: null,
  acknowledgedAt: null,
  firstReplyAt: null,
  resolvedAt: null,
};
const req = (over: Partial<ClockableRequest>): ClockableRequest => ({ ...blank, ...over });

describe('ackDueFrom — the acknowledgement target (QM-D12)', () => {
  it('gives a critical filing 30 minutes inside desk hours', () => {
    const filed = utc('2026-07-07T05:00:00Z'); // 10:30 IST, Tuesday
    expect(istHM(ackDueFrom(filed, DEFAULT_DESK, 'critical'))).toBe('11:00');
  });

  it('walks desk hours, not wall-clock: filed 17:30 Saturday, the clock starts Monday 08:00', () => {
    // 17:30 IST Saturday = after close; Sunday is not a working day (Mon-Sat week), so every
    // urgency's target counts from Monday's opening bell.
    const filed = utc('2026-07-04T12:00:00Z'); // 17:30 IST, Saturday
    const cases: Array<[Parameters<typeof ackDueFrom>[2], string]> = [
      ['critical', '08:30'], // 30 min after Monday open
      ['high', '09:00'],
      ['normal', '12:00'],
      ['low', '17:00'], // one full working day: open to close
    ];
    for (const [urgency, expected] of cases) {
      const due = ackDueFrom(filed, DEFAULT_DESK, urgency);
      expect(ist(due).getUTCDay(), urgency).toBe(1); // Monday, Sunday skipped
      expect(ist(due).getUTCDate(), urgency).toBe(6); // 2026-07-06
      expect(istHM(due), urgency).toBe(expected);
    }
  });

  it('spills into the next working day when the target crosses the close', () => {
    const filed = utc('2026-07-07T11:15:00Z'); // 16:45 IST Tuesday — 15 min before close
    const due = ackDueFrom(filed, DEFAULT_DESK, 'high'); // 1h: 15 min today + 45 min tomorrow
    expect(ist(due).getUTCDate()).toBe(8); // Wednesday
    expect(istHM(due)).toBe('08:45');
  });

  it('escalating urgency never lengthens the acknowledgement deadline', () => {
    const filed = utc('2026-07-07T05:00:00Z');
    const at = (u: keyof typeof ACK_TARGET_WORKING_HOURS) => +ackDueFrom(filed, DEFAULT_DESK, u);
    expect(at('critical')).toBeLessThan(at('high'));
    expect(at('high')).toBeLessThan(at('normal'));
    expect(at('normal')).toBeLessThan(at('low'));
  });

  it('is always tighter than or equal to nothing — an ack target exists for every urgency', () => {
    // The seed table is CONFIG-to-be; what must hold structurally is full urgency coverage.
    expect(Object.keys(ACK_TARGET_WORKING_HOURS).sort()).toEqual(['critical', 'high', 'low', 'normal']);
  });
});

describe('readClocks — the derivation table (QM-D15: derived at read, never stored)', () => {
  const now = utc('2026-07-07T06:00:00Z');
  const before = utc('2026-07-07T05:00:00Z'); // 1h before now
  const wellBefore = utc('2026-07-07T04:00:00Z'); // 2h before now
  const after = utc('2026-07-07T09:00:00Z'); // 3h after now

  // Every ack state × every response state — the clocks must be fully independent.
  const ackVariant: Record<ClockState, Partial<ClockableRequest>> = {
    na: { ackDueAt: null },
    due: { ackDueAt: after },
    overdue: { ackDueAt: before },
    met: { ackDueAt: before, acknowledgedAt: wellBefore },
  };
  const responseVariant: Record<ClockState, Partial<ClockableRequest>> = {
    na: { slaDueAt: null },
    due: { slaDueAt: after },
    overdue: { slaDueAt: before },
    met: { slaDueAt: after, firstReplyAt: before },
  };
  const states: ClockState[] = ['na', 'due', 'overdue', 'met'];

  for (const a of states) {
    for (const r of states) {
      it(`reads ack=${a} alongside response=${r}`, () => {
        const reading = readClocks(req({ ...ackVariant[a], ...responseVariant[r] }), now);
        expect(reading.ackState).toBe(a);
        expect(reading.responseState).toBe(r);
        // remainingMs is null exactly when the state is na, a number otherwise.
        expect(reading.ackRemainingMs === null).toBe(a === 'na');
        expect(reading.responseRemainingMs === null).toBe(r === 'na');
      });
    }
  }

  it('signs remainingMs: positive margin while due, negative once overdue', () => {
    const r = readClocks(req({ ackDueAt: after, slaDueAt: before }), now);
    expect(r.ackRemainingMs).toBe(3 * HOUR);
    expect(r.responseRemainingMs).toBe(-1 * HOUR);
  });

  it('treats the boundary instant as still due, not overdue', () => {
    const r = readClocks(req({ ackDueAt: now, slaDueAt: now }), now);
    expect(r.ackState).toBe('due');
    expect(r.responseState).toBe('due');
    expect(r.ackRemainingMs).toBe(0);
  });
});

describe('readClocks — stopped clocks freeze at the stored timestamp, not at now', () => {
  it('an on-time acknowledgement stays met (with its margin) no matter how much later it is read', () => {
    const dueAt = utc('2026-07-07T06:00:00Z');
    const acknowledgedAt = utc('2026-07-07T05:00:00Z'); // 1h early
    const muchLater = utc('2026-07-10T12:00:00Z');
    const r = readClocks(req({ ackDueAt: dueAt, acknowledgedAt }), muchLater);
    expect(r.ackState).toBe('met');
    expect(r.ackRemainingMs).toBe(HOUR); // frozen margin — would be hugely negative against now
  });

  it('acknowledged-late reads overdue while unacknowledged, then met after the fact', () => {
    const dueAt = utc('2026-07-07T07:00:00Z');
    const lateAck = utc('2026-07-07T09:00:00Z');

    // While now sits between the target and the (future) acknowledgement, the clock is
    // running and the queue must nag: overdue.
    const during = readClocks(req({ ackDueAt: dueAt }), utc('2026-07-07T08:00:00Z'));
    expect(during.ackState).toBe('overdue');
    expect(during.ackRemainingMs).toBe(-1 * HOUR);

    // Once acknowledged, the state is met — lateness lives in the negative remaining, not in
    // a permanent overdue. Same ruling as slaState: a late reply is still a reply.
    const afterFact = readClocks(req({ ackDueAt: dueAt, acknowledgedAt: lateAck }), utc('2026-07-07T10:00:00Z'));
    expect(afterFact.ackState).toBe('met');
    expect(afterFact.ackRemainingMs).toBe(-2 * HOUR);
  });

  it('a late first reply likewise reads met, carrying its lateness', () => {
    const r = readClocks(
      req({ slaDueAt: utc('2026-07-07T06:00:00Z'), firstReplyAt: utc('2026-07-07T08:30:00Z') }),
      utc('2026-07-07T12:00:00Z'),
    );
    expect(r.responseState).toBe('met');
    expect(r.responseRemainingMs).toBe(-2.5 * HOUR);
  });
});

describe('readClocks — what stops the response clock', () => {
  it('resolution stops it when no written reply ever went out (answered on the phone)', () => {
    const r = readClocks(
      req({
        status: 'resolved',
        slaDueAt: utc('2026-07-07T06:00:00Z'),
        resolvedAt: utc('2026-07-07T05:00:00Z'),
      }),
      utc('2026-07-07T10:00:00Z'),
    );
    expect(r.responseState).toBe('met');
    expect(r.responseRemainingMs).toBe(HOUR); // measured against resolvedAt
  });

  it('the first reply wins over a later resolution — it is the earlier, measured event', () => {
    const r = readClocks(
      req({
        status: 'resolved',
        slaDueAt: utc('2026-07-07T06:00:00Z'),
        firstReplyAt: utc('2026-07-07T05:00:00Z'),
        resolvedAt: utc('2026-07-07T09:00:00Z'),
      }),
      utc('2026-07-07T10:00:00Z'),
    );
    expect(r.responseRemainingMs).toBe(HOUR); // due − firstReplyAt, not due − resolvedAt
  });

  it('resolution does NOT stop the acknowledgement clock — only a recorded look does', () => {
    // Deliberate: readClocks derives from what is STORED. If resolving should imply a look,
    // the action layer stamps acknowledgedAt; the derivation never infers one event from
    // another.
    const r = readClocks(
      req({
        status: 'resolved',
        ackDueAt: utc('2026-07-07T06:00:00Z'),
        slaDueAt: utc('2026-07-07T06:00:00Z'),
        resolvedAt: utc('2026-07-07T05:00:00Z'),
      }),
      utc('2026-07-07T10:00:00Z'),
    );
    expect(r.responseState).toBe('met');
    expect(r.ackState).toBe('overdue');
  });
});

describe('readClocks — parked and pre-filing states', () => {
  it('not_a_request reads na on both clocks even with stale targets still stored', () => {
    const r = readClocks(
      req({
        status: 'not_a_request',
        ackDueAt: utc('2026-07-07T05:00:00Z'),
        slaDueAt: utc('2026-07-07T05:00:00Z'),
      }),
      utc('2026-07-07T10:00:00Z'),
    );
    expect(r).toEqual({ ackState: 'na', responseState: 'na', ackRemainingMs: null, responseRemainingMs: null });
  });

  it('an unfiled item has no ack clock yet, but its response clock is already running', () => {
    // QM-D12: the ack clock fires on FILING, so pre-filing there is no target (na). The
    // response clock anchors on arrival (SD-COM-11) — slow triage must not hide lateness.
    const r = readClocks(
      req({ status: 'unfiled', slaDueAt: utc('2026-07-07T05:00:00Z') }),
      utc('2026-07-07T06:00:00Z'),
    );
    expect(r.ackState).toBe('na');
    expect(r.responseState).toBe('overdue');
  });

  it('null targets read na regardless of status', () => {
    for (const status of ['unfiled', 'open', 'waiting', 'resolved']) {
      const r = readClocks(req({ status }), utc('2026-07-07T06:00:00Z'));
      expect(r.ackState, status).toBe('na');
      expect(r.responseState, status).toBe('na');
    }
  });
});
