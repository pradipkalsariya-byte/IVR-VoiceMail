import 'server-only';
import { db } from './db';

/**
 * The staff directory every picker uses ("Acting as", owner, routed-to). Oversight holders
 * float to the top, then A-Z.
 *
 * This replaces the four scattered `orderBy: [{ isLeadership: 'desc' }, …]` queries: per
 * QM-D9/D26 (2026-08-07) the boolean is deprecated as anything but seed shorthand, and no
 * read may key on it — the `permissions` grant list is the truth, even for a sort order.
 * Sorted in JS because Prisma cannot order by array membership; the directory is a dozen
 * rows, and Array.sort is stable so the A-Z order survives within each band.
 */
export async function staffDirectory() {
  const all = await db.staff.findMany({ orderBy: { name: 'asc' } });
  return [...all].sort(
    (a, b) =>
      Number(b.permissions.includes('oversight')) - Number(a.permissions.includes('oversight')),
  );
}

/**
 * The people who may own a request at this campus — feedback #19.
 *
 * Group scope can own anything; everyone else only their own campus. This is the picker half
 * of the rule: assignableOwner in core/permissions.ts refuses out-of-scope owners on the way
 * in, and this stops them ever being offered. Both halves are wanted — the server rule is the
 * one that has to hold, and a picker that offers a choice the server will reject is a bad
 * screen even when it is a safe one.
 */
export function staffAssignableAt<T extends { scopeOrgUnitId: string }>(
  staff: readonly T[],
  campusOrgUnitId: string,
): T[] {
  return staff.filter(
    s => s.scopeOrgUnitId === 'group' || s.scopeOrgUnitId === campusOrgUnitId,
  );
}
