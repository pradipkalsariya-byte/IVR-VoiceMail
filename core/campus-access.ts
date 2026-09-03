// core/campus-access.ts — which campuses a person may work in.
//
// VK, 27-Aug-2026: "multi-campus rights are possible... that way real users can test the app
// other than Richa / Rashida and me."
//
// The problem being fixed: `Staff.scopeOrgUnitId` holds exactly ONE campus. Somebody who covers
// FSK and FWGS could only be given `group` — every campus, present and future — or entered
// twice. The first is how a testing account quietly becomes an estate-wide one, and it is
// precisely what happens when you add colleagues in a hurry.
//
// Ported from route-planning's `lib/auth/campus-access.ts`, which solved this first. Its split is
// kept deliberately: the RULES are pure and live here with their own tests; the fetching lives in
// lib/session.ts. One place decides, so a page and an action cannot disagree about who may see
// what — nine pages in route-planning each guessed differently before it did this.
//
// GRANTS SAY WHERE. PERMISSIONS SAY WHAT. A desk assistant does the same job at both campuses, so
// capabilities stay on Staff and are not repeated per campus. Keeping them apart means adding a
// campus can never accidentally widen what somebody may DO.
//
// PURE.

import { GROUP_ROOT_ID } from './permissions';

export interface CampusGrant {
  /** A campus OrgUnit id, or null for group scope — every campus, including future ones. */
  campusOrgUnitId: string | null;
}

/** True when any grant is group-scoped: this person follows campuses added later. */
export function hasGroupScope(grants: readonly CampusGrant[]): boolean {
  return grants.some(g => g.campusOrgUnitId === null);
}

/**
 * Every campus this person may work in, resolved against the campuses that actually exist.
 *
 * Sorted for a stable UI: two calls in one render must not disagree about which campus is first.
 *
 * A group grant returns ALL campuses rather than the literal 'group' string, so every caller
 * downstream can treat the answer as a plain list and nobody has to remember the special case.
 * That translation being in one place is most of this file's value.
 */
export function accessibleCampusIds(
  grants: readonly CampusGrant[],
  allCampusIds: readonly string[],
): string[] {
  if (hasGroupScope(grants)) return [...allCampusIds].sort();
  const held = new Set(
    grants
      .map(g => g.campusOrgUnitId)
      .filter((id): id is string => id !== null && allCampusIds.includes(id)),
  );
  return [...held].sort();
}

/** May this person act on something belonging to this campus? */
export function canReachCampus(
  grants: readonly CampusGrant[],
  campusOrgUnitId: string,
  allCampusIds: readonly string[],
): boolean {
  return accessibleCampusIds(grants, allCampusIds).includes(campusOrgUnitId);
}

/**
 * Which campus a request is FOR, given what the person asked for and what they hold.
 *
 * Returns `switchedAway` when the request named a campus they cannot reach. Silently narrowing
 * without saying so is how somebody spends ten minutes wondering where their work went; the
 * screen can say "showing FSK instead" because this told it to.
 *
 * `null` means they hold nothing — a real state for a colleague who has been added but not yet
 * granted anything, and one the UI must handle rather than crash on.
 */
export function resolveCampus(
  requested: string | null | undefined,
  grants: readonly CampusGrant[],
  allCampusIds: readonly string[],
): { campusOrgUnitId: string | null; switchedAway: boolean } {
  const reachable = accessibleCampusIds(grants, allCampusIds);
  if (reachable.length === 0) return { campusOrgUnitId: null, switchedAway: false };
  const want = (requested ?? '').trim();
  if (want && reachable.includes(want)) return { campusOrgUnitId: want, switchedAway: false };
  return { campusOrgUnitId: reachable[0], switchedAway: Boolean(want) };
}

/**
 * Turn a legacy single scope into grants.
 *
 * The migration does this in SQL for existing rows; this exists so the same rule is available in
 * code — a seed, a test, or a person still carrying only the old column must resolve identically
 * to one the migration touched. Two implementations of "what does scopeOrgUnitId mean" is exactly
 * the drift this file was written to end.
 */
export function grantsFromLegacyScope(scopeOrgUnitId: string): CampusGrant[] {
  return [{ campusOrgUnitId: scopeOrgUnitId === GROUP_ROOT_ID ? null : scopeOrgUnitId }];
}

/**
 * Is this a sane set of grants to store?
 *
 * A group grant alongside named campuses is not wrong so much as MEANINGLESS — the named ones
 * change nothing — and storing it means a later reader cannot tell whether the named campuses
 * were intended to be a restriction. The screen collapses it rather than saving a shape that
 * cannot be interpreted later.
 */
export function normaliseGrants(grants: readonly CampusGrant[]): CampusGrant[] {
  if (hasGroupScope(grants)) return [{ campusOrgUnitId: null }];
  const seen = new Set<string>();
  const out: CampusGrant[] = [];
  for (const g of grants) {
    if (g.campusOrgUnitId === null || seen.has(g.campusOrgUnitId)) continue;
    seen.add(g.campusOrgUnitId);
    out.push({ campusOrgUnitId: g.campusOrgUnitId });
  }
  return out;
}

/** Plain-language summary for the access screen and the audit trail. */
export function describeGrants(
  grants: readonly CampusGrant[],
  campusName: (id: string) => string,
): string {
  if (grants.length === 0) return 'no campuses yet';
  if (hasGroupScope(grants)) return 'every campus, including any added later';
  const names = grants
    .map(g => g.campusOrgUnitId)
    .filter((id): id is string => id !== null)
    .map(campusName)
    .sort();
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
