// core/user-admin.ts — who may curate desk access, and what a valid grant looks like.
//
// Feedback #34, 26-Aug-2026: "right now a developer runs a script to give someone access —
// those users, adding them here, is still pending." Until this screen exists, every new
// colleague needs an engineer, which is why Ayushi, Prapti and Smita Henry are still waiting.
//
// PURE: no database, no session, no framework. The screen and the server actions both consult
// these functions, so the list a person is offered and the rule that admits them cannot drift.

import { ACTIONS, GROUP_ROOT_ID, type Action } from './permissions';
import { SCHOOL_DOMAINS } from './senders';

/**
 * Who may curate access.
 *
 * An env var, deliberately independent of the table it gates — the same shape as every other
 * admin allowlist in this estate. It has to be a door that does not depend on any row existing,
 * or the first grant could never be made. Fails closed to VK when unset rather than falling
 * open to everyone, which is the failure mode this pattern exists to avoid.
 */
export function userAdminEmails(env: Record<string, string | undefined> = process.env): string[] {
  const raw = (env.USER_ADMIN_EMAILS ?? '').trim();
  const list = raw
    ? raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : ['vardan.kabra@fountainheadschools.org'];
  return [...new Set(list)];
}

export function canAdministerUsers(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!email) return false;
  return userAdminEmails(env).includes(email.trim().toLowerCase());
}

/**
 * The capability bundles the desk actually uses, so nobody has to reason about seven
 * checkboxes to add a colleague. Individual capabilities stay editable underneath — a preset
 * is a starting point, not a role enum, and the grant list remains the truth (QM-D9/D26: no
 * read may key on a role boolean).
 */
export interface RolePreset {
  key: string;
  label: string;
  hint: string;
  permissions: Action[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'front-desk',
    label: 'Front desk',
    hint: 'Works the queue: sees requests, files them, assigns and resolves.',
    permissions: ['view_queue', 'file', 'assign', 'resolve'],
  },
  {
    key: 'front-desk-lead',
    label: 'Front desk lead',
    hint: 'Everything the desk does, plus the second pair of eyes on serious items.',
    permissions: ['view_queue', 'file', 'assign', 'resolve', 'triage_approve'],
  },
  {
    key: 'leadership',
    label: 'Leadership',
    hint: 'Reads the oversight view. Does not work the queue day to day.',
    permissions: ['oversight', 'view_queue'],
  },
  {
    key: 'safeguarding',
    label: 'Safeguarding lead',
    hint: 'Named access to safeguarding records — grant this to specific people, never a team.',
    permissions: ['view_queue', 'file', 'assign', 'resolve', 'view_safeguarding'],
  },
  {
    key: 'view-only',
    label: 'View only',
    hint: 'Can see the queue and nothing else. Useful while someone is learning the desk.',
    permissions: ['view_queue'],
  },
];

export interface GrantInput {
  email: string;
  name: string;
  roleLabel: string;
  /**
   * LEGACY single scope. Still written for one release so the grant backfill can be audited
   * against it; authorisation no longer reads it. Derived from campusOrgUnitIds by the screen.
   */
  scopeOrgUnitId: string;
  /**
   * The campuses this person may work in (27-Aug-2026). GROUP_ROOT_ID anywhere in the list means
   * every campus, present and future. An EMPTY list is a real, valid state: somebody added but
   * not yet given a campus, who can sign in and see nothing until an admin says where.
   */
  campusOrgUnitIds: string[];
  permissions: string[];
}

export type GrantCheck = { ok: true } | { ok: false; reason: string };

/**
 * Is this a grant we are willing to store?
 *
 * Checked on the SERVER before any write, not merely in the form — a server action is a public
 * endpoint and anyone signed in can post to it.
 */
export function validateGrant(
  input: GrantInput,
  knownCampusIds: readonly string[],
): GrantCheck {
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'An email address is required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: `"${input.email}" is not an email address.` };
  }

  // The sign-in door already refuses non-school domains; granting access to an address that
  // can never sign in would create a row that looks like access and is not.
  const domain = email.split('@')[1];
  if (!SCHOOL_DOMAINS.includes(domain)) {
    return {
      ok: false,
      reason:
        `${domain} is not a school domain, so that address could never sign in. ` +
        'Use their Fountainhead address.',
    };
  }

  if (!input.name.trim()) return { ok: false, reason: 'A name is required — the audit trail records a person, not an address.' };

  const scopeOk =
    input.scopeOrgUnitId === GROUP_ROOT_ID || knownCampusIds.includes(input.scopeOrgUnitId);
  if (!scopeOk) {
    return { ok: false, reason: `"${input.scopeOrgUnitId}" is not a campus this desk covers.` };
  }

  // Every campus in the list must be real. Checked on the SERVER for the same reason as the rest
  // of this function: the form is not the boundary, the action is, and an id that no campus
  // matches would create a grant that silently reaches nothing.
  const badCampus = input.campusOrgUnitIds.find(
    id => id !== GROUP_ROOT_ID && !knownCampusIds.includes(id),
  );
  if (badCampus) {
    return { ok: false, reason: `"${badCampus}" is not a campus this desk covers.` };
  }

  const unknown = input.permissions.filter(p => !ACTIONS.includes(p as Action));
  if (unknown.length) {
    return { ok: false, reason: `Unknown capability: ${unknown.join(', ')}.` };
  }

  // A person with no capability at all is not "restricted", they are stuck: they can sign in
  // and then see a refusal on every screen. Better to say so than to store it.
  if (input.permissions.length === 0) {
    return { ok: false, reason: 'Give them at least one capability, or remove them instead.' };
  }

  return { ok: true };
}

/**
 * Safeguarding is named-access: it belongs to specific people, never to a team or a campus.
 * Surfaced as a warning rather than a refusal — the rule is about deliberateness, and there
 * are legitimate safeguarding leads.
 */
export function safeguardingWarning(permissions: readonly string[]): string | null {
  return permissions.includes('view_safeguarding')
    ? 'This grants access to safeguarding records. Those are named-access by rule — grant it ' +
      'to a specific person who holds that responsibility, never as part of a team default.'
    : null;
}
