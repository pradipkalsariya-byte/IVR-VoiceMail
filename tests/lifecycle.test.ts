import { describe, it, expect } from 'vitest';
import { canActOnStatus } from '../core/lifecycle';
import { STATUSES } from '../core/taxonomy';

// The gate that keeps the record page honest with the queue's promise: nothing enters the
// working queue unfiled, so nothing unfiled takes a reply or a resolution either.
describe('canActOnStatus', () => {
  it('refuses reply and resolve on an unfiled record, with a reason a person can read', () => {
    for (const action of ['reply', 'resolve'] as const) {
      const v = canActOnStatus(action, 'unfiled');
      expect(v.allowed).toBe(false);
      if (!v.allowed) {
        expect(v.reason).toMatch(/file/i);
        expect(v.reason).not.toMatch(/QM-D|_/); // plain language, no ruling ids, no snake_case
      }
    }
  });

  it('refuses acting on parked not-a-request mail, pointing at filing as the way back in', () => {
    const v = canActOnStatus('reply', 'not_a_request');
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toMatch(/file it first/i);
  });

  it('allows the filed statuses — including reply-on-resolved, which reopens honestly', () => {
    for (const status of ['open', 'waiting', 'resolved']) {
      expect(canActOnStatus('reply', status).allowed).toBe(true);
      expect(canActOnStatus('resolve', status).allowed).toBe(true);
    }
  });

  it('covers every schema status one way or the other', () => {
    for (const s of STATUSES) {
      // Total over the enum: no status may throw or return undefined.
      expect(typeof canActOnStatus('reply', s).allowed).toBe('boolean');
    }
  });
});
