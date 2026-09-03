// tests/cluster-actions.test.ts — the QM-D19 fan-out: one action, per-member effects.
//
// Fixture identities follow the synthetic-only rule (CLAUDE.md cardinal rule 2): NATO-set
// names, no phones, no student ids. `tests/no-real-data.test.ts` scans this file too.
import { describe, it, expect } from 'vitest';
import {
  planClusterAction,
  clusterStats,
  type ClusterMemberInput,
} from '../core/cluster-actions';

const LABEL = 'Red alert day — why is school open?';

/** One of each status, so every skip rule has a member to bite on. */
const members: ClusterMemberInput[] = [
  { id: 'r-open', ref: 'FD-0101', status: 'open', ownerId: null, familyId: 'fam-alpha' },
  { id: 'r-waiting', ref: 'FD-0102', status: 'waiting', ownerId: 's-lead', familyId: 'fam-bravo' },
  { id: 'r-resolved', ref: 'FD-0103', status: 'resolved', ownerId: 's-lead', familyId: 'fam-charlie' },
  { id: 'r-nar', ref: 'FD-0104', status: 'not_a_request', ownerId: null, familyId: 'fam-delta' },
  { id: 'r-unfiled', ref: 'FD-0105', status: 'unfiled', ownerId: null, familyId: 'fam-alpha' },
];

const ids = (xs: { memberId: string }[]) => xs.map(x => x.memberId).sort();

describe('planClusterAction — effect-plan shape', () => {
  it('every applied member gets its OWN activity naming the cluster (the record is the atom)', () => {
    const plan = planClusterAction({
      action: 'note', clusterLabel: LABEL, members, note: 'Answered publicly at assembly.',
    });
    expect(plan.apply.length).toBeGreaterThan(0);
    for (const e of plan.apply) {
      expect(e.activity.detail).toContain(`via cluster "${LABEL}"`);
      expect(e.activity.detail).toContain('Answered publicly at assembly.');
    }
    // One effect per member, no member twice — a fan-out, not an aggregate.
    expect(new Set(plan.apply.map(e => e.memberId)).size).toBe(plan.apply.length);
  });

  it('accounts for every member exactly once: apply ∪ skipped = members, disjoint', () => {
    for (const action of ['note', 'resolve', 'assign'] as const) {
      const plan = planClusterAction({
        action, clusterLabel: LABEL, members,
        note: 'x', assignee: { id: 's-golf', name: 'Golf Sample' },
      });
      const all = [...ids(plan.apply), ...ids(plan.skipped)].sort();
      expect(all).toEqual(members.map(m => m.id).sort());
    }
  });

  it('is deterministic — same inputs, same plan', () => {
    const a = planClusterAction({ action: 'resolve', clusterLabel: LABEL, members, note: 'Done.' });
    const b = planClusterAction({ action: 'resolve', clusterLabel: LABEL, members, note: 'Done.' });
    expect(a).toEqual(b);
  });
});

describe('planClusterAction — skip rules, never silent', () => {
  it('resolve skips already-resolved, not_a_request and unfiled members, each with a reason', () => {
    const plan = planClusterAction({ action: 'resolve', clusterLabel: LABEL, members });
    expect(ids(plan.apply)).toEqual(['r-open', 'r-waiting']);
    expect(ids(plan.skipped)).toEqual(['r-nar', 'r-resolved', 'r-unfiled']);
    for (const s of plan.skipped) {
      expect(s.reason.length).toBeGreaterThan(10); // plain language, not a code
      expect(s.reason).toContain(s.ref); // names the record a human can go look at
    }
    // The unfiled skip cites the triage gate — bulk resolve must not route around QM-D10.
    expect(plan.skipped.find(s => s.memberId === 'r-unfiled')!.reason).toContain('QM-D10');
  });

  it('resolve effects set status + resolvedAt and nothing else', () => {
    const plan = planClusterAction({ action: 'resolve', clusterLabel: LABEL, members });
    for (const e of plan.apply) {
      expect(e.update).toEqual({ status: 'resolved', setResolvedAt: true });
      expect(e.activity.kind).toBe('resolved');
    }
  });

  it('assign skips resolved members, not_a_request, and same-owner no-ops', () => {
    const plan = planClusterAction({
      action: 'assign', clusterLabel: LABEL, members,
      assignee: { id: 's-lead', name: 'Golf Sample' },
    });
    // r-waiting is already owned by s-lead → a no-op reassignment, skipped by name.
    expect(ids(plan.apply)).toEqual(['r-open', 'r-unfiled']);
    expect(ids(plan.skipped)).toEqual(['r-nar', 'r-resolved', 'r-waiting']);
    expect(plan.skipped.find(s => s.memberId === 'r-waiting')!.reason).toContain('Golf Sample');
    for (const e of plan.apply) {
      expect(e.update).toEqual({ ownerId: 's-lead' });
      expect(e.activity.kind).toBe('assigned');
      expect(e.activity.detail).toContain('Golf Sample');
    }
  });

  it('assign skips members that CONCERN the assignee — QM-D32 holds in bulk too', () => {
    // Without this, the cluster was the one door through which the about-person could end up
    // owning the complaint about them (single-request assign refuses via assignableOwner).
    const withAbout: ClusterMemberInput[] = [
      { id: 'r-about', ref: 'FD-0201', status: 'open', ownerId: null, familyId: 'fam-alpha',
        aboutStaffIds: ['s-coach'] },
      { id: 'r-plain', ref: 'FD-0202', status: 'open', ownerId: null, familyId: 'fam-bravo' },
    ];
    const plan = planClusterAction({
      action: 'assign', clusterLabel: LABEL, members: withAbout,
      assignee: { id: 's-coach', name: 'Kilo Sample' },
    });
    expect(ids(plan.apply)).toEqual(['r-plain']);
    expect(plan.skipped.find(s => s.memberId === 'r-about')!.reason).toContain('QM-D32');

    // The same members hand over cleanly to someone the complaint does NOT concern.
    const ok = planClusterAction({
      action: 'assign', clusterLabel: LABEL, members: withAbout,
      assignee: { id: 's-lead', name: 'Golf Sample' },
    });
    expect(ids(ok.apply)).toEqual(['r-about', 'r-plain']);
  });

  it('note reaches resolved and unfiled members (annotation, not state) but never not_a_request', () => {
    const plan = planClusterAction({ action: 'note', clusterLabel: LABEL, members, note: 'FYI.' });
    expect(ids(plan.apply)).toEqual(['r-open', 'r-resolved', 'r-unfiled', 'r-waiting']);
    expect(ids(plan.skipped)).toEqual(['r-nar']);
    for (const e of plan.apply) expect(e.update).toEqual({}); // trail only, no field writes
  });

  it('refuses an empty note and an assign without an assignee', () => {
    expect(() => planClusterAction({ action: 'note', clusterLabel: LABEL, members, note: '  ' }))
      .toThrow(/needs some text/);
    expect(() => planClusterAction({ action: 'assign', clusterLabel: LABEL, members }))
      .toThrow(/someone to assign/);
  });
});

describe('planClusterAction — satisfaction stays individual (QM-D18/D19)', () => {
  it('a resolve plan never contains a satisfaction write, anywhere in its shape', () => {
    const plan = planClusterAction({
      action: 'resolve', clusterLabel: LABEL, members, note: 'Closed after the public answer.',
    });
    // Belt: no update object carries the key. Braces: the whole serialised plan is clean, so
    // a future field rename cannot smuggle it in under another spelling of the same intent.
    for (const e of plan.apply) {
      expect(Object.keys(e.update)).not.toContain('satisfaction');
      expect(Object.keys(e.update)).not.toContain('satisfactionAbsentReason');
    }
    expect(JSON.stringify(plan).toLowerCase()).not.toContain('satisfaction');
  });
});

describe('clusterStats — the QM-D19 counting rule', () => {
  it('reports one issue, N complainants — never N issues', () => {
    // fam-alpha appears twice (two messages, one family) → 4 complainants, not 5.
    expect(clusterStats(members)).toEqual({ issues: 1, complainants: 4 });
  });

  it('unidentified senders each count as one complainant', () => {
    expect(clusterStats([
      { id: 'a', familyId: null },
      { id: 'b', familyId: null },
      { id: 'c', familyId: 'fam-echo' },
    ])).toEqual({ issues: 1, complainants: 3 });
  });

  it('an empty member list is zero issues, zero complainants', () => {
    expect(clusterStats([])).toEqual({ issues: 0, complainants: 0 });
  });
});
