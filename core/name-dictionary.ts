// core/name-dictionary.ts — masking names by knowing them, rather than by guessing their shape.
//
// The 26-Aug audit found 196 of 214 redacted emails still carrying a name, and the striking
// thing was WHOSE: "Ayushi Kalal" is on the desk team, "Trishiv" and "Neishca" are students,
// the signatures were staff. Every leak was one of our own people — and we hold all of them in
// the database already.
//
// So this is a dictionary, not a detector. Pattern-matching a name from prose is unreliable in
// both directions: it misses "Dhyaana" and it eats "Morker drop" out of a transport request.
// An exact list misses neither, and touches nothing else.
//
// PURE. The caller fetches the names; this decides what to do with them.

/** A first name shorter than this is skipped — too many collide with ordinary words. */
const MIN_NAME_LENGTH = 4;

/**
 * Words that are somebody's name AND an ordinary word, so masking them would mangle prose.
 *
 * Real examples from the roster: a child called "Harmony" shares a name with a section, and
 * masking the word would turn "Grade 1 Harmony" into "Grade 1 «name»" in every message that
 * mentions the class. The section names are the worst offenders because the school uses them
 * constantly, so they are excluded by name rather than by a cleverness that might drift.
 */
const AMBIGUOUS = new Set([
  'harmony', 'apotheosis', 'sagacity', 'vivacity', 'ardour', 'exuberance', 'enlighten',
  'rhapsody', 'acuity', 'cognizance', 'envisage', 'mettle', 'freedom', 'red', 'blue', 'green',
  'junior', 'senior', 'grade', 'section', 'school', 'front', 'desk', 'team', 'parent', 'student',
  'transport', 'admission', 'accounts', 'principal', 'coordinator', 'teacher', 'driver',
]);

/**
 * Pull the people out of the strings the database holds.
 *
 * Family labels arrive as "Parent of Aarav Shah" / "Parents of Aarav Shah"; staff arrive as a
 * plain name. Both the full name and each part are returned, because a parent writing about
 * their own child usually uses the first name alone ("Dhyaana's drop").
 */
export function namesFromLabels(labels: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of labels) {
    const label = (raw ?? '').trim();
    if (!label) continue;

    // Seed and demo rows ("Family 41", "Demo One") are not real people and add only noise.
    if (/^family\s+\d+$/i.test(label)) continue;

    // \b\s* rather than \s+ so a truncated "Parent of" strips to nothing instead of
    // surviving as a candidate — it produced the literal name "Parentof" on the first run.
    const stripped = label.replace(/^\s*parents?\s+of\b\s*/i, '').trim();
    if (!stripped) continue;

    const consider = (candidate: string) => {
      // Spaces are KEPT: stripping them turned "Aarav Shah" into "AaravShah", which then
      // matched nothing at all. Only punctuation and digits go.
      const w = candidate.replace(/[^\p{L}\s'’-]/gu, '').replace(/\s+/g, ' ').trim();
      if (w.length < MIN_NAME_LENGTH) return;
      if (AMBIGUOUS.has(w.toLowerCase())) return;
      out.add(w);
    };

    consider(stripped);                       // the whole name
    for (const part of stripped.split(/\s+/)) consider(part);  // and each part
  }
  return [...out];
}

/**
 * Build one regex that matches any known name, longest first.
 *
 * Longest-first matters: with "Aarav" and "Aarav Shah" both in the list, alternation would
 * otherwise match the shorter one and leave the surname sitting in the text — a half-masked
 * name reads as a redaction that worked, which is worse than none.
 *
 * Returns null for an empty list rather than an empty alternation, which would match
 * everywhere.
 */
export function nameMatcher(names: readonly string[]): RegExp | null {
  const usable = [...new Set(names.filter(n => n.length >= MIN_NAME_LENGTH))]
    .sort((a, b) => b.length - a.length);
  if (usable.length === 0) return null;
  const escaped = usable.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

/** Mask every known name in the text. Everything else is left exactly as written. */
export function maskKnownNames(text: string, matcher: RegExp | null): string {
  if (!matcher || !text) return text;
  matcher.lastIndex = 0;
  return text.replace(matcher, '«name»');
}
