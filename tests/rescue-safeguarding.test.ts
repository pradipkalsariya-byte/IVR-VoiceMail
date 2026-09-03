// The invariant this file exists to protect: a safeguarding item in the working queue always
// has a response clock. FD-0780 came back into the live queue without one, which made it
// visible on the queue page but invisible to every breach report — most of the way back to
// being hidden, which is the exact failure the rescue pass was written to undo.
import { describe, it, expect } from 'vitest';
import { slaDue, clockStart } from '../core/sla';
import { CHILD_SAFETY_RE } from '../core/classify';

describe('un-parking restores the response clock, not just visibility', () => {
  const arrived = new Date('2026-08-20T04:30:00Z');

  it('gives a critical item a due date ahead of its arrival', () => {
    const due = slaDue(arrived, 'critical');
    expect(due.getTime()).toBeGreaterThan(arrived.getTime());
  });

  it('starts the clock from arrival, not from the repair', () => {
    // Anchoring on "now" would quietly forgive however long the item sat hidden.
    const started = clockStart(arrived);
    expect(started.getTime()).toBeLessThan(new Date('2026-08-21T00:00:00Z').getTime());
  });

  it('a critical target is tighter than a low one', () => {
    expect(slaDue(arrived, 'critical').getTime()).toBeLessThan(slaDue(arrived, 'low').getTime());
  });
});

describe('the pattern the rescue selects on', () => {
  it('matches the words that put FD-0780 and FD-0781 in the wrong place', () => {
    expect(CHILD_SAFETY_RE.test('a teacher mocked her in front of everyone')).toBe(true);
    expect(CHILD_SAFETY_RE.test('she was left alone at the gate')).toBe(true);
  });

  it('does not match ordinary school mail', () => {
    expect(CHILD_SAFETY_RE.test('Mock exam timetable')).toBe(false);
    expect(CHILD_SAFETY_RE.test('Fee receipt for August')).toBe(false);
  });
});
