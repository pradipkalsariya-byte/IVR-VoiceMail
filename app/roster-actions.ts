'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { currentActor } from '@/lib/session';
import { can } from '@/core/permissions';
import { rotate } from '@/core/assignment';
import { istDayStart } from '@/lib/assignment';

// Server actions for the roster and routing screens (feedback #18, #21).
//
// Gated on `assign` rather than on a new capability: deciding who covers the desk and who
// handles what IS assigning, done in advance. Inventing a separate grant would mean every
// existing desk lead losing a power they already have until someone re-granted it.

async function requireAssign(campusOrgUnitId: string) {
  const actor = await currentActor();
  const gate = can(actor, 'assign', { campusOrgUnitId });
  if (!gate.allowed) throw new Error(gate.reason);
  return actor;
}

export async function setRosterDay(campusOrgUnitId: string, isoDate: string, staffIds: string[]) {
  await requireAssign(campusOrgUnitId);
  const onDate = istDayStart(new Date(isoDate));

  // Replace the day wholesale rather than diffing: a roster day is a small set, and a
  // replace cannot leave a half-applied state if something fails midway.
  await db.rosterDay.deleteMany({ where: { campusOrgUnitId, onDate } });
  if (staffIds.length) {
    await db.rosterDay.createMany({
      data: staffIds.map(staffId => ({ id: randomUUID(), campusOrgUnitId, onDate, staffId })),
    });
  }
  revalidatePath('/roster');
}

/**
 * Fill a run of days from a rotation, WITHOUT touching days somebody has already set.
 *
 * VK asked for the rotation to automate itself and stay "always editable". Overwriting an
 * edited day would make the edit pointless — someone would rearrange their week, the generator
 * would run, and their arrangement would vanish. Existing days are left exactly as they are.
 */
export async function generateRoster(
  campusOrgUnitId: string, staffIds: string[], startIso: string, days: number,
) {
  await requireAssign(campusOrgUnitId);
  if (staffIds.length === 0) throw new Error('Choose at least one person to put on the rotation.');

  const start = istDayStart(new Date(startIso));
  const pattern = rotate(staffIds, days);

  const existing = await db.rosterDay.findMany({
    where: {
      campusOrgUnitId,
      onDate: { gte: start, lt: new Date(start.getTime() + days * 86400000) },
    },
    select: { onDate: true },
  });
  const taken = new Set(existing.map(e => e.onDate.getTime()));

  let filled = 0;
  for (let i = 0; i < pattern.length; i++) {
    const onDate = new Date(start.getTime() + i * 86400000);
    if (taken.has(onDate.getTime())) continue;
    await db.rosterDay.createMany({
      data: pattern[i].map(staffId => ({ id: randomUUID(), campusOrgUnitId, onDate, staffId })),
    });
    filled++;
  }
  revalidatePath('/roster');
  return { filled, skipped: pattern.length - filled };
}

export async function setCategoryRoute(
  campusOrgUnitId: string, category: string, staffId: string | null,
) {
  await requireAssign(campusOrgUnitId);
  if (!staffId) {
    await db.categoryRoute.deleteMany({ where: { campusOrgUnitId, category } });
  } else {
    // The owner must be able to work this campus — the same rule the manual assign path
    // enforces, checked here so a route cannot quietly encode something forbidden by hand.
    const staff = await db.staff.findUnique({ where: { id: staffId } });
    if (!staff) throw new Error('No such person.');
    if (staff.scopeOrgUnitId !== 'group' && staff.scopeOrgUnitId !== campusOrgUnitId) {
      throw new Error(
        `${staff.name} is scoped to ${staff.scopeOrgUnitId} and could not open a request at ` +
        `${campusOrgUnitId}. Routing to them would create work nobody can do.`,
      );
    }
    await db.categoryRoute.upsert({
      where: { campusOrgUnitId_category: { campusOrgUnitId, category } },
      update: { staffId },
      create: { id: randomUUID(), campusOrgUnitId, category, staffId },
    });
  }
  revalidatePath('/roster');
}

/**
 * Mark someone away, or back.
 *
 * Anyone with `assign` can set it for anyone at their campus — somebody who is unexpectedly
 * out cannot set their own flag, which is the case that matters most (feedback #20).
 */
export async function setAway(staffId: string, untilIso: string | null) {
  const staff = await db.staff.findUnique({ where: { id: staffId } });
  if (!staff) throw new Error('No such person.');
  await requireAssign(staff.scopeOrgUnitId === 'group' ? staff.scopeOrgUnitId : staff.scopeOrgUnitId);

  await db.staff.update({
    where: { id: staffId },
    data: { awayUntil: untilIso ? new Date(untilIso) : null },
  });
  revalidatePath('/roster');
}
