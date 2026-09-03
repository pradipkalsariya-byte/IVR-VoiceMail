import 'server-only';
import { db } from './db';
import { namesFromLabels, nameMatcher } from '@/core/name-dictionary';

// The database half of name masking. Cached, because the list changes rarely and rebuilding a
// 3,000-name alternation on every email would dominate the cost of classifying one.

let cached: { matcher: RegExp | null; names: number; builtAt: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function knownNameMatcher(force = false) {
  if (!force && cached && Date.now() - cached.builtAt < TTL_MS) return cached;

  const [families, staff] = await Promise.all([
    db.family.findMany({ select: { label: true } }),
    db.staff.findMany({ select: { name: true } }),
  ]);

  const names = namesFromLabels([
    ...families.map(f => f.label),
    ...staff.map(s => s.name),
  ]);

  cached = { matcher: nameMatcher(names), names: names.length, builtAt: Date.now() };
  return cached;
}
