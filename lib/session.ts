import 'server-only';
import { cookies } from 'next/headers';
import { db } from './db';
import { authMode, personaSwitchEnabled } from './auth/mode';
import { sessionIdentity } from './auth/gate';
import { accessibleCampusIds, grantsFromLegacyScope } from '@/core/campus-access';

/**
 * Who is acting. Since the Google sign-in port (2026-08-24) this resolves in LAYERS, per the
 * estate rule — sign-in is WHO YOU ARE, the persona is WHAT YOU ARE ACTING AS:
 *
 *   google mode — the verified session names the real Staff row; a request that cannot prove
 *   a provisioned identity gets an error, never a fallback (fail closed: server actions are
 *   POST endpoints callable without ever rendering a page). While ENABLE_PERSONA_SWITCH=true
 *   (the pilot's flag-with-a-deadline), the acting cookie may then select a persona ON TOP.
 *
 *   legacy mode — the pre-sign-in world, unchanged: acting cookie, then the DEV_USER_EMAIL
 *   fallback. Production runs here until the OAuth client's credentials land.
 *
 * Every write derives its actor from HERE, never from a form field.
 */
export const ACTING_COOKIE = 'front_desk_actor';

async function staffById(id: string) {
  return db.staff.findUnique({ where: { id }, include: { scope: true } });
}

/** The REAL signed-in staff member (google mode), independent of any persona. Null in
 *  legacy mode — there is no verified identity to report there. */
export async function currentIdentity() {
  const session = await sessionIdentity();
  if (!session?.sub) return null;
  const staff = await staffById(session.sub);
  return staff ? { staff, email: session.email } : null;
}

export async function currentActor() {
  const jar = await cookies();
  const actingId = jar.get(ACTING_COOKIE)?.value;

  if (authMode() === 'google') {
    const session = await sessionIdentity();
    const real = session?.sub ? await staffById(session.sub) : null;
    if (!real) throw new Error('Sign in required.');
    if (actingId && personaSwitchEnabled()) {
      const persona = await staffById(actingId);
      if (persona) return persona;
    }
    return real;
  }

  const fallbackEmail = process.env.DEV_USER_EMAIL ?? 'frontdesk.fsk@fountainhead.test';
  const actor = actingId
    ? await staffById(actingId)
    : await db.staff.findUnique({ where: { email: fallbackEmail }, include: { scope: true } });
  return actor ?? (await db.staff.findFirstOrThrow({ include: { scope: true } }));
}

/**
 * The campuses this actor may see.
 *
 * Reads StaffCampus GRANTS as of 27-Aug-2026, not `scopeOrgUnitId`. That column holds exactly one
 * campus, so a colleague covering FSK and FWGS could only be given `group` — every campus,
 * present and future — which is how a testing account quietly becomes an estate-wide one. The
 * rules themselves are pure and live in core/campus-access.ts with their own tests; this only
 * fetches and applies them, the same split route-planning uses.
 *
 * A GROUP grant still sees every campus: that is how central oversight works without a second
 * application (scope cascade, R3 §6).
 *
 * FALLS BACK to the legacy column when a person has no grants at all. The migration backfilled
 * everyone, so this should never fire — but "no grants" resolving to "no campuses" would lock a
 * real person out of the whole app on the strength of a row that failed to copy, and a fallback
 * that reproduces their existing access exactly cannot widen anything.
 */
export async function visibleCampusIds(actor: { id: string; scopeOrgUnitId: string }) {
  const [grants, campuses] = await Promise.all([
    db.staffCampus.findMany({
      where: { staffId: actor.id },
      select: { campusOrgUnitId: true },
    }),
    db.orgUnit.findMany({ where: { type: 'CAMPUS' }, select: { id: true } }),
  ]);
  const allIds = campuses.map(c => c.id);
  const effective = grants.length > 0 ? grants : grantsFromLegacyScope(actor.scopeOrgUnitId);
  return accessibleCampusIds(effective, allIds);
}
