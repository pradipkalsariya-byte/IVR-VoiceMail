// The 7 July 2026 evidence, encoded as tests. These are the regression guard for the one
// feature the analysis specifically demanded.
import { describe, it, expect } from 'vitest';
import { signature, detectClusters, type ClusterCandidate } from '../core/coordination';

const at = (iso: string) => new Date(iso);
// originatorKey defaults to the id because in every fixture below each message comes from a
// DIFFERENT family — the premise the whole 7 July evidence rests on ("four families sent the
// same templated subject"). Pass it explicitly to model ONE person sending repeatedly, which
// is what the live switchboard data turned out to be full of.
const c = (
  id: string, subject: string, iso: string, category?: string, originatorKey?: string,
): ClusterCandidate =>
  ({ id, subject, arrivedAt: at(iso), category: category ?? null, originatorKey: originatorKey ?? id });

describe('signature normalisation', () => {
  it('strips Re: and Fwd: prefixes', () => {
    expect(signature('Re: Timely decision').key).toBe('timely decision');
    expect(signature('Fwd: Timely decision').key).toBe('timely decision');
    expect(signature('RE: FW: Timely decision').key).toBe('timely decision');
  });

  it('detects a pasted "Subject:" label and strips it', () => {
    const s = signature('Subject: Request for Timely Decision-Making During Heavy Rainfall');
    expect(s.pastedTemplate).toBe(true);
    expect(s.key).toBe('request for timely decision making during heavy rainfall');
  });

  it('treats a pasted-label subject as identical to the un-pasted one', () => {
    const a = signature('Request for Timely Decision-Making During Heavy Rainfall');
    const b = signature('Subject: Request for Timely Decision-Making During Heavy Rainfall');
    expect(a.key).toBe(b.key);
    expect(a.pastedTemplate).toBe(false);
    expect(b.pastedTemplate).toBe(true);
  });

  it('ignores punctuation and emoji differences', () => {
    expect(signature('New Bus-stop request !!').key).toBe(signature('new bus stop request').key);
    expect(signature('Disappointed ☹️').key).toBe('disappointed');
  });

  it('yields an empty key for a blank subject', () => {
    expect(signature('').key).toBe('');
    expect(signature('   ').key).toBe('');
  });
});

describe('the 7 July cluster', () => {
  // Four families sent the same templated subject inside 25 minutes; two pasted the label.
  const sevenJuly: ClusterCandidate[] = [
    c('a', 'Request for Timely Decision-Making During Heavy Rainfall', '2026-07-07T02:57:00Z', 'weather-closure'),
    c('b', 'Request for Timely Decision-Making During Heavy Rainfall', '2026-07-07T03:05:00Z', 'weather-closure'),
    c('c', 'Subject: Request for Timely Decision-Making During Heavy Rainfall', '2026-07-07T03:11:00Z', 'weather-closure'),
    c('d', 'Subject: Request for Timely Decision-Making During Heavy Rainfall', '2026-07-07T03:20:00Z', 'weather-closure'),
  ];

  it('groups the four identical subjects as ONE coordinated event', () => {
    const [cluster] = detectClusters(sevenJuly);
    expect(cluster.kind).toBe('template');
    expect(cluster.isCoordinated).toBe(true);
    expect(cluster.memberIds).toHaveLength(4);
  });

  it('counts the pasted-template tell and cites it in the reason', () => {
    const [cluster] = detectClusters(sevenJuly);
    expect(cluster.templateHits).toBe(2);
    expect(cluster.reason).toMatch(/pasted "Subject:"/);
  });

  it('flags coordination on only TWO messages when one pasted the label', () => {
    // Two families is normally coincidence — but nobody types "Subject:" into a subject box.
    const two = sevenJuly.slice(1, 3);
    const [cluster] = detectClusters(two);
    expect(cluster?.isCoordinated).toBe(true);
    expect(cluster.memberIds).toHaveLength(2);
  });

  it('does NOT flag two identical subjects with no template tell', () => {
    const two = [
      c('x', 'About bus stop canceled', '2025-07-05T04:00:00Z', 'transport'),
      c('y', 'About bus stop canceled', '2025-07-05T09:00:00Z', 'transport'),
    ];
    expect(detectClusters(two).filter(k => k.kind === 'template')).toHaveLength(0);
  });

  it('separates the same wording sent months apart', () => {
    const apart = [
      c('p', 'Change in uniform & shoes policy', '2026-05-19T04:00:00Z', 'uniform'),
      c('q', 'Change in uniform & shoes policy', '2026-05-19T06:00:00Z', 'uniform'),
      c('r', 'Change in uniform & shoes policy', '2026-05-19T07:00:00Z', 'uniform'),
      c('s', 'Change in uniform & shoes policy', '2026-11-19T07:00:00Z', 'uniform'),
    ];
    const templates = detectClusters(apart).filter(k => k.kind === 'template');
    expect(templates).toHaveLength(1);
    expect(templates[0].memberIds).toEqual(['p', 'q', 'r']);
  });
});

describe('topic bursts — different wording, same decision', () => {
  it('catches the wider 7 July shape: varied subjects, one topic', () => {
    const varied = [
      c('1', 'Red alert', '2026-07-07T02:50:00Z', 'weather-closure'),
      c('2', 'School holiday decision', '2026-07-07T03:00:00Z', 'weather-closure'),
      c('3', 'Declaration of holiday due to heavy rainfall', '2026-07-07T03:15:00Z', 'weather-closure'),
      c('4', '7 July fiasco', '2026-07-07T03:20:00Z', 'weather-closure'),
    ];
    const [cluster] = detectClusters(varied);
    expect(cluster.kind).toBe('topic');
    expect(cluster.memberIds).toHaveLength(4);
    expect(cluster.isCoordinated).toBe(false); // a burst, not proven organised
    expect(cluster.reason).toMatch(/one decision of ours/);
  });

  it('does not raise a topic burst below the threshold', () => {
    const two = [
      c('1', 'Healthy Menu', '2025-07-02T04:00:00Z', 'food-health'),
      c('2', 'The Food shortage faced by kids', '2025-07-02T05:00:00Z', 'food-health'),
    ];
    expect(detectClusters(two)).toHaveLength(0);
  });

  it('never double-counts: a template member is not also a topic member', () => {
    const mixed = [
      c('a', 'Request for Timely Decision-Making During Heavy Rainfall', '2026-07-07T02:57:00Z', 'weather-closure'),
      c('b', 'Subject: Request for Timely Decision-Making During Heavy Rainfall', '2026-07-07T03:05:00Z', 'weather-closure'),
      c('c', 'Red alert', '2026-07-07T03:10:00Z', 'weather-closure'),
      c('d', 'School holiday decision', '2026-07-07T03:12:00Z', 'weather-closure'),
      c('e', '7 July fiasco', '2026-07-07T03:18:00Z', 'weather-closure'),
    ];
    const clusters = detectClusters(mixed);
    const all = clusters.flatMap(k => k.memberIds);
    expect(new Set(all).size).toBe(all.length);
    expect(clusters.find(k => k.kind === 'template')!.memberIds.sort()).toEqual(['a', 'b']);
    expect(clusters.find(k => k.kind === 'topic')!.memberIds.sort()).toEqual(['c', 'd', 'e']);
  });
});

// Regression for the live-data failure found 2026-08-25: the queue's top seven cards all read
// "Looks coordinated", and Patterns claimed "231 separate families raised the same
// subject-matter" — when every member was ONE switchboard number redialling. The detector had
// no concept of who sent anything, so it counted messages and called them families.
// The number below is from the RESERVED 9900000xxx range, never the real caller from the
// live data — see tests/no-real-data.test.ts, which fails the build on a real-looking one.
describe('a cluster must be several PEOPLE, not one person repeating', () => {
  const sameCaller = (n: number, subject: string, cat: string): ClusterCandidate[] =>
    Array.from({ length: n }, (_, i) =>
      c(`m${i}`, subject, `2026-08-24T0${i}:00:00Z`, cat, 'phone:9900000231'));

  it('does not call one number redialling a coordinated template', () => {
    const clusters = detectClusters(sameCaller(6, 'Missed call at 10:53', 'switchboard'));
    expect(clusters.filter(k => k.kind === 'template')).toHaveLength(0);
  });

  it('does not call one number redialling a topic burst', () => {
    expect(detectClusters(sameCaller(9, 'Missed call', 'switchboard'))).toHaveLength(0);
  });

  it('still clusters when the SAME wording comes from different people', () => {
    const many = [
      c('a', 'Bus stop moved without notice', '2026-08-24T01:00:00Z', 'transport', 'fam-1'),
      c('b', 'Bus stop moved without notice', '2026-08-24T02:00:00Z', 'transport', 'fam-2'),
      c('d', 'Bus stop moved without notice', '2026-08-24T03:00:00Z', 'transport', 'fam-3'),
    ];
    const [cluster] = detectClusters(many);
    expect(cluster.kind).toBe('template');
    expect(cluster.isCoordinated).toBe(true);
    expect(cluster.distinctOriginators).toBe(3);
  });

  it('counts one family writing from two addresses as one complainant', () => {
    // Same household, two mailboxes — three messages, two people, below the threshold.
    const household = [
      c('a', 'Bus stop moved without notice', '2026-08-24T01:00:00Z', 'transport', 'fam-1'),
      c('b', 'Bus stop moved without notice', '2026-08-24T02:00:00Z', 'transport', 'fam-1'),
      c('d', 'Bus stop moved without notice', '2026-08-24T03:00:00Z', 'transport', 'fam-2'),
    ];
    expect(detectClusters(household).filter(k => k.kind === 'template')).toHaveLength(0);
  });

  it('reports distinctOriginators, and never above the member count', () => {
    const varied = [
      c('1', 'Red alert', '2026-07-07T02:50:00Z', 'weather-closure', 'fam-1'),
      c('2', 'School holiday decision', '2026-07-07T03:00:00Z', 'weather-closure', 'fam-2'),
      c('3', 'Declaration of holiday', '2026-07-07T03:15:00Z', 'weather-closure', 'fam-3'),
      c('4', '7 July fiasco', '2026-07-07T03:20:00Z', 'weather-closure', 'fam-3'),
    ];
    const [cluster] = detectClusters(varied);
    expect(cluster.memberIds).toHaveLength(4);
    expect(cluster.distinctOriginators).toBe(3);
    expect(cluster.reason).toContain('3 separate families');
    expect(cluster.distinctOriginators).toBeLessThanOrEqual(cluster.memberIds.length);
  });

  it('treats unattributable senders as ONE originator, not one each', () => {
    // Not knowing who sent something is not evidence that it came from someone new.
    const unknown = Array.from({ length: 8 }, (_, i) =>
      ({ id: `u${i}`, subject: 'Missed call', arrivedAt: at(`2026-08-24T0${i}:00:00Z`),
         category: 'switchboard', originatorKey: null }));
    expect(detectClusters(unknown)).toHaveLength(0);
  });
});
