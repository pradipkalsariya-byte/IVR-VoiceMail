'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { currentActor } from '@/lib/session';
import { canAdministerUsers, validateGrant, type GrantInput } from '@/core/user-admin';
import { describeGrants, normaliseGrants } from '@/core/campus-access';
import { GROUP_ROOT_ID } from '@/core/permissions';

// Server actions for the users screen — feedback #34.
//
// Every one of these re-checks the admin gate itself. A server action is a public endpoint:
// anyone signed in can post to it, and the fact that the SCREEN is only linked for admins
// protects nothing. The screen hiding the form is a courtesy; this is the rule.

async function requireUserAdmin() {
  const actor = await currentActor();
  if (!canAdministerUsers(actor.email)) {
    throw new Error(
      'Only a desk administrator can change who has access. Ask Vardan to add you to ' +
        'USER_ADMIN_EMAILS if this should be part of your job.',
    );
  }
  return actor;
}

async function knownCampusIds(): Promise<string[]> {
  const units = await db.orgUnit.findMany({ select: { id: true } });
  return units.map(u => u.id);
}

/** Campus id -> the name a person would recognise, for the audit line. */
async function campusNames(): Promise<Map<string, string>> {
  const units = await db.orgUnit.findMany({ select: { id: true, name: true } });
  return new Map(units.map(u => [u.id, u.name]));
}

/**
 * Audit every access change — who did it, to whom, and what changed.
 *
 * Written BEFORE the caller returns, and deliberately not wrapped in a catch that swallows: if
 * the trail cannot be written the change should fail loudly rather than happen unrecorded. An
 * access-control screen whose log is best-effort is a log nobody can rely on.
 */
async function logAccessChange(
  actorId: string, subjectEmail: string, kind: 'granted' | 'changed' | 'revoked', detail: string,
) {
  await db.accessChange.create({
    data: { id: randomUUID(), actorId, subjectEmail, kind, detail },
  });
}

export async function upsertStaffAccess(input: GrantInput) {
  const actor = await requireUserAdmin();

  const check = validateGrant(input, await knownCampusIds());
  if (!check.ok) throw new Error(check.reason);

  const email = input.email.trim().toLowerCase();
  const existing = await db.staff.findUnique({ where: { email } });

  await db.staff.upsert({
    where: { email },
    update: {
      name: input.name.trim(),
      roleLabel: input.roleLabel.trim() || 'Front Desk',
      scopeOrgUnitId: input.scopeOrgUnitId,
      permissions: input.permissions,
    },
    create: {
      id: `staff-${email.replace(/[^a-z0-9]+/g, '-')}`,
      email,
      name: input.name.trim(),
      roleLabel: input.roleLabel.trim() || 'Front Desk',
      scopeOrgUnitId: input.scopeOrgUnitId,
      permissions: input.permissions,
    },
  });

  // ------------------------------------------------------------------ campus grants
  //
  // VK, 27-Aug-2026: colleagues beyond the original three need to test, and several of them
  // cover more than one campus. `scopeOrgUnitId` holds exactly one, so the grants below are what
  // authorisation actually reads (lib/session.ts). The column is still written above, for one
  // release, so the backfill can be audited against it.
  //
  // REPLACED WHOLESALE, not merged. A campus the admin unticked must actually go: merging would
  // make this screen able to add access and never remove it, which is the wrong direction for
  // the one screen whose job is to be exact about who can reach what.
  const staff = await db.staff.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const wanted = normaliseGrants(
    input.campusOrgUnitIds.includes(GROUP_ROOT_ID)
      ? [{ campusOrgUnitId: null }]
      : input.campusOrgUnitIds.map(id => ({ campusOrgUnitId: id })),
  );
  const before = await db.staffCampus.findMany({
    where: { staffId: staff.id }, select: { campusOrgUnitId: true },
  });
  await db.staffCampus.deleteMany({ where: { staffId: staff.id } });
  for (const g of wanted) {
    await db.staffCampus.create({
      data: {
        id: randomUUID(),
        staffId: staff.id,
        campusOrgUnitId: g.campusOrgUnitId,
        grantedBy: actor.id,
      },
    });
  }

  const names = await campusNames();
  const nameOf = (id: string) => names.get(id) ?? id;
  await logAccessChange(
    actor.id, email, existing ? 'changed' : 'granted',
    `${input.permissions.join(', ') || 'no capabilities'} — ${describeGrants(wanted, nameOf)}` +
      (existing ? ` (was: ${existing.permissions.join(', ') || 'none'} — ${describeGrants(before, nameOf)})` : ''),
  );
  revalidatePath('/users');
}

/**
 * Remove someone's access.
 *
 * The Staff row is KEPT and emptied of capabilities rather than deleted: it is referenced by
 * owned requests, by receivedBy and routedTo on the call log, and by every activity row that
 * records what they did. Deleting it would either fail on the foreign keys or, worse, orphan
 * the audit trail — and "who did this" is the only question a log exists to answer.
 */
export async function revokeStaffAccess(email: string) {
  const actor = await requireUserAdmin();
  const target = (email || '').trim().toLowerCase();

  if (target === actor.email?.toLowerCase()) {
    throw new Error(
      'You cannot remove your own access from this screen — that is how a desk ends up with ' +
        'nobody able to administer it. Ask another administrator.',
    );
  }

  const staff = await db.staff.findUnique({ where: { email: target } });
  if (!staff) throw new Error('No such person.');

  await db.staff.update({ where: { email: target }, data: { permissions: [] } });
  await logAccessChange(
    actor.id, target, 'revoked',
    `Removed ${staff.permissions.join(', ') || 'no'} capabilities at ${staff.scopeOrgUnitId}. ` +
      'The person stays on file so the audit trail they appear in stays readable.',
  );
  revalidatePath('/users');
}
