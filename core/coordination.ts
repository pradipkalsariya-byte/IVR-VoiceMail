// core/coordination.ts — "is this one event, or many?"
//
// PURE. The feature the 7 July 2026 evidence demanded: thirteen conversations began that
// morning about one decision to keep school open through a red alert. Four carried an
// essentially identical subject, and two of those contained the literal word "Subject:" —
// which is what happens when someone copies a circulated template that had the subject
// written as a line of text and pastes the whole thing in.
//
// The school experienced one coordinated action as thirteen unrelated upset families, and
// answered each individually. A coordinated action needs ONE clear public answer.

export interface Signature {
  /** Normalised comparison key. */
  key: string;
  /** True when the raw subject contained a pasted "Subject:" prefix — the copy-paste tell. */
  pastedTemplate: boolean;
}

const STRIP_PREFIX = /^\s*((re|fwd|fw)\s*:\s*)+/i;
const PASTED = /^\s*subject\s*:\s*/i;

/**
 * Reduce a subject to a comparison key. Strips reply/forward prefixes, strips a pasted
 * "Subject:" label, lowercases, drops punctuation and emoji, collapses whitespace.
 */
export function signature(rawSubject: string): Signature {
  let s = (rawSubject ?? '').normalize('NFC');
  let pastedTemplate = false;

  // Peel Re:/Fwd: and a pasted "Subject:" in either order, repeatedly.
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(STRIP_PREFIX, '');
    if (PASTED.test(s)) { pastedTemplate = true; s = s.replace(PASTED, ''); }
    if (s === before) break;
  }

  // Strip punctuation, symbols and pictographs. The variation selectors and ZWJ must go
  // explicitly: "☹️" is U+2639 followed by U+FE0F, and \p{S} only catches the first, which
  // left an invisible character behind and broke signature equality.
  const key = s
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}︎️‍]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { key, pastedTemplate };
}

export interface ClusterCandidate {
  id: string;
  subject: string;
  arrivedAt: Date;
  campusOrgUnitId?: string | null;
  category?: string | null;
  /**
   * Who raised it — a family id, failing that a sender address, failing that a caller's
   * number. Null when the originator genuinely cannot be attributed.
   *
   * This is what makes a cluster mean anything. Every claim the detector makes is about
   * DIFFERENT people converging ("families do not independently invent the same wording"),
   * and until 2026-08-25 nothing checked it: one switchboard number redialling produced a
   * 231-member cluster reading "231 separate families raised the same subject-matter" on
   * live data. Unattributable items deliberately collapse to ONE originator rather than
   * counting as one each — being unable to tell people apart is not evidence they differ.
   */
  originatorKey?: string | null;
}

export interface DetectedCluster {
  signature: string;
  label: string;
  memberIds: string[];
  windowStart: Date;
  windowEnd: Date;
  templateHits: number;
  isCoordinated: boolean;
  /** 'template' = identical wording. 'topic' = different wording, same subject-matter burst. */
  kind: 'template' | 'topic';
  reason: string;
  /** How many DIFFERENT people this cluster represents. Never larger than memberIds.length. */
  distinctOriginators: number;
}

export interface DetectOptions {
  /** How close together members must arrive. Default 24 hours. */
  windowHours?: number;
  /** Identical-wording members needed to call it coordinated on wording alone. Default 3. */
  templateThreshold?: number;
  /** Same-category members needed to call it a topic burst. Default 3. */
  topicThreshold?: number;
}

const HOUR = 3_600_000;

/**
 * Group candidates into clusters. Two passes:
 *
 *  1. TEMPLATE — identical normalised subject inside the window. Coordinated when the count
 *     reaches `templateThreshold`, OR when two-plus share wording and at least one carried a
 *     pasted "Subject:" prefix. Two families do not independently paste the same label.
 *  2. TOPIC — same category inside the window, for members not already in a template cluster.
 *     Catches the wider 7 July shape: eleven weather messages in varied wording.
 */
export function detectClusters(
  items: readonly ClusterCandidate[],
  opts: DetectOptions = {},
): DetectedCluster[] {
  const windowMs = (opts.windowHours ?? 24) * HOUR;
  const templateThreshold = opts.templateThreshold ?? 3;
  const topicThreshold = opts.topicThreshold ?? 3;

  const sorted = [...items].sort((a, b) => +a.arrivedAt - +b.arrivedAt);
  const out: DetectedCluster[] = [];
  const claimed = new Set<string>();

  // ---- pass 1: identical wording ----------------------------------------------------
  const byKey = new Map<string, { items: ClusterCandidate[]; pasted: number }>();
  for (const it of sorted) {
    const sig = signature(it.subject);
    if (!sig.key) continue; // a blank subject can never anchor a template cluster
    const bucket = byKey.get(sig.key) ?? { items: [], pasted: 0 };
    bucket.items.push(it);
    if (sig.pastedTemplate) bucket.pasted += 1;
    byKey.set(sig.key, bucket);
  }

  for (const [key, bucket] of byKey) {
    for (const group of splitByWindow(bucket.items, windowMs)) {
      if (group.length < 2) continue;
      const people = distinctOriginators(group);
      const pasted = group.filter(g => signature(g.subject).pastedTemplate).length;
      // Distinct PEOPLE, not distinct messages. One person sending the same subject three
      // times is a repeat, not a coordination — and repeats are exactly what the live data
      // is full of (a switchboard number redialling).
      const coordinated = people >= templateThreshold || (people >= 2 && pasted >= 1);
      if (!coordinated) continue;

      group.forEach(g => claimed.add(g.id));
      out.push({
        signature: key,
        label: group[0].subject.replace(PASTED, '').replace(STRIP_PREFIX, '').trim(),
        memberIds: group.map(g => g.id),
        windowStart: group[0].arrivedAt,
        windowEnd: group[group.length - 1].arrivedAt,
        templateHits: pasted,
        isCoordinated: true,
        kind: 'template',
        distinctOriginators: people,
        reason: pasted > 0
          ? `${people} people sent an identical subject, and ${pasted} of those messages contain a pasted "Subject:" line — the signature of a circulated template.`
          : `${people} different families sent an identical subject within ${Math.round(windowMs / HOUR)} hours. Families do not independently invent the same wording.`,
      });
    }
  }

  // ---- pass 2: same topic, different wording -----------------------------------------
  const byCat = new Map<string, ClusterCandidate[]>();
  for (const it of sorted) {
    if (claimed.has(it.id) || !it.category) continue;
    const arr = byCat.get(it.category) ?? [];
    arr.push(it);
    byCat.set(it.category, arr);
  }

  for (const [cat, list] of byCat) {
    for (const group of splitByWindow(list, windowMs)) {
      const people = distinctOriginators(group);
      // Same rule as pass 1: the burst has to be several PEOPLE. Without this, every
      // category with enough traffic from one repeat caller became a "topic burst".
      if (people < topicThreshold) continue;
      group.forEach(g => claimed.add(g.id));
      out.push({
        signature: `topic:${cat}`,
        label: `${people} families about the same thing`,
        memberIds: group.map(g => g.id),
        windowStart: group[0].arrivedAt,
        windowEnd: group[group.length - 1].arrivedAt,
        templateHits: 0,
        isCoordinated: false,
        kind: 'topic',
        distinctOriginators: people,
        reason: `${people} separate families raised the same subject-matter within ${Math.round(windowMs / HOUR)} hours. Likely one decision of ours, not ${people} unrelated problems.`,
      });
    }
  }

  return out.sort((a, b) => b.memberIds.length - a.memberIds.length);
}

/**
 * How many different people a group represents. Items with no attributable originator all
 * collapse into a single bucket: not knowing who sent something is not evidence that it came
 * from someone new, and treating each unknown as its own person is precisely what produced
 * the 231-member phantom cluster.
 */
function distinctOriginators(group: readonly ClusterCandidate[]): number {
  return new Set(group.map(g => g.originatorKey || ' unattributed')).size;
}

/** Split a time-sorted list wherever the gap to the next item exceeds the window. */
function splitByWindow<T extends { arrivedAt: Date }>(list: T[], windowMs: number): T[][] {
  const sorted = [...list].sort((a, b) => +a.arrivedAt - +b.arrivedAt);
  const groups: T[][] = [];
  let cur: T[] = [];
  for (const it of sorted) {
    if (cur.length === 0 || +it.arrivedAt - +cur[cur.length - 1].arrivedAt <= windowMs) cur.push(it);
    else { groups.push(cur); cur = [it]; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}
