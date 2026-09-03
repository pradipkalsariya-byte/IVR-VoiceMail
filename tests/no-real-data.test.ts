/**
 * Guard: no real personal data in this repo.
 *
 * CLAUDE.md cardinal rule 2 is "synthetic data only — no real parent, child or staff record
 * enters this repo". On 2026-08-06 that rule was breached and caught only by a pre-commit
 * sweep: the redaction and sender-classification fixtures had been seeded with the *actual*
 * strings from the live archive — four children's names, three staff names, a real student
 * id and a real mobile number. It is an easy breach to commit, because a redaction test
 * naturally wants the real input it must mask.
 *
 * Names cannot be detected mechanically, so this guard covers the two identifier classes
 * that CAN be: numbers must come from reserved blocks, ids must use a reserved year. Any
 * pasted-in real value fails here instead of reaching a commit.
 *
 * If you need a new fixture value, take it from the reserved ranges below — do not widen
 * the guard.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.next', '.scratch', '.git', 'analysis']);
const SCAN_EXT = /\.(ts|tsx|js|mjs|md|json|sql|html)$/;
const SELF = 'no-real-data.test.ts';

/** Reserved synthetic ranges. Anything outside these is presumed real until proven otherwise. */
const RESERVED_PHONE = /^0?9900000\d{3}$/;          // 9900000xxx — not a live Indian series
const RESERVED_ID_YEAR = /^(FSK|FWGS|FSM|FALH|FPV|FPA|FSNC)2099/i;  // joining year 2099

/** Shapes that look like real personal identifiers wherever they appear. */
const PHONE_SHAPE = /\b0?[6-9]\d{9}\b/g;
const ID_SHAPE = /\b(?:FSK|FWGS|FSM|FALH|FPV|FPA|FSNC)\d{4,8}\b/gi;
/** Shorteners resolve to live, often unauthenticated, links — never commit one. */
const SHORTENER = /\b(?:tinyurl\.com|bit\.ly|goo\.gl|t\.co|rb\.gy|shorturl\.at)\b/gi;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (SCAN_EXT.test(name) && name !== SELF) out.push(full);
  }
  return out;
}

/** Collect every offending literal as "path:line value" so a failure names the fix site. */
function offenders(shape: RegExp, allowed: RegExp | null): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.match(shape) ?? []) {
        if (allowed?.test(m)) continue;
        hits.push(`${relative(ROOT, file).split(sep).join('/')}:${i + 1} ${m}`);
      }
    });
  }
  return hits;
}

describe('no real personal data is committed', () => {
  it('scans a non-trivial number of files (the walker itself works)', () => {
    expect(sourceFiles(ROOT).length).toBeGreaterThan(20);
  });

  it('every phone-shaped number comes from the reserved 9900000xxx block', () => {
    expect(offenders(PHONE_SHAPE, RESERVED_PHONE)).toEqual([]);
  });

  it('every student-id-shaped value uses the reserved 2099 joining year', () => {
    expect(offenders(ID_SHAPE, RESERVED_ID_YEAR)).toEqual([]);
  });

  it('no URL shorteners, which carry live tokens', () => {
    expect(offenders(SHORTENER, null)).toEqual([]);
  });
});
