// core/permissions.ts — capability checks, replacing the `isLeadership` boolean (QM-D9/QM-D26,
// 2026-08-07).
//
// PURE. No I/O, no Prisma, no Next imports, deterministic.
//
// This is deliberately a COARSE grant list, not a policy engine. The prototype proves the
// SHAPE — a capability checked per action, scoped by org unit — and graduates into the main
// repo's `can(world, query)`. Resist the urge to add wildcards, grant hierarchies or a DSL
// here; the moment this needs one, it belongs in the engine, not the prototype.
//
// Every deny carries a MANDATORY plain-language reason, mirroring core/classify.ts (AI-15's
// discipline applied to access: if a refusal cannot explain itself, it reads as a bug and gets
// worked around — a named reason gets argued with, which is the behaviour we want).

/** The actions this prototype distinguishes. Coarse on purpose — one per checkpoint. */
export const ACTIONS = [
  'view_queue',
  'file',
  'assign',
  'resolve',
  'oversight',
  'triage_approve',
  'view_safeguarding',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * What the server session knows about the person acting. Built from lib/session.ts's actor,
 * NEVER from a form field (cardinal rule 5).
 */
export interface ActorGrants {
  /** Capability grants, e.g. ['oversight'] or ['view_queue', 'file', 'assign', 'resolve']. */
  permissions: string[];
  /** The org-unit node whose subtree this actor sees (scope cascade, R3 §6). */
  scopeOrgUnitId: string;
  /** An outsourced vendor owner (R3-23) — can own a request without being school staff. */
  isVendor: boolean;
}

/** What the check is about. Caller-supplied plain values so this module stays pure. */
export interface ResourceRef {
  campusOrgUnitId?: string;
  isSafeguarding?: boolean;
  /**
   * Caller-computed (`request.ownerId === actor.id`). A boolean rather than two ids so the
   * module never grows identity plumbing — the caller already knows who is asking.
   */
  isOwnedByActor?: boolean;
  /**
   * Caller-computed (`request.aboutStaffIds.includes(actor.id)`): this complaint is ABOUT the
   * person asking. QM-D33 excludes them from the record's audience entirely — the substance
   * reaches them through a recorded conversation, never through the record.
   */
  isAboutActor?: boolean;
}

/** Never a bare false — a deny always says why, in language a person can argue with. */
export interface Decision {
  allowed: boolean;
  reason: string;
}

/**
 * The GROUP root of the org tree (prisma/seed.ts). A posting scoped here sees every campus —
 * that is how central oversight works without a second application. The prototype's tree is
 * exactly one root over flat campuses, so scope resolution is an equality check; the engine
 * version walks the real tree.
 */
export const GROUP_ROOT_ID = 'group';

const allow = (reason: string): Decision => ({ allowed: true, reason });
const deny = (reason: string): Decision => ({ allowed: false, reason });

/**
 * Can this actor take this action, on this resource?
 *
 * Rules, in the order they are checked:
 *  1. Grant: the actor must hold the action's grant. Holding 'oversight' implies every OTHER
 *     action (it is the leadership capability — cross-campus view AND the ability to act) —
 *     with exactly one carve-out, below.
 *  2. Safeguarding is a NAMED grant (R3-4 shape; Tier-2 per R3-18): anything safeguarding
 *     requires the explicit 'view_safeguarding' grant REGARDLESS of what else the actor holds.
 *     'oversight' deliberately does NOT imply it — seniority is not need-to-know where a child
 *     is concerned.
 *  3. Scope: the resource's campus must sit under the actor's scope node, unless the actor
 *     holds 'oversight' (cross-campus is what that grant is for).
 *  4. Vendors (R3-23) may resolve ONLY requests they own. An outsourced operator closing
 *     someone else's request — or a request it cannot name — fails closed.
 */
export function can(actor: ActorGrants, action: Action, resource?: ResourceRef): Decision {
  const holds = (g: string) => actor.permissions.includes(g);

  // 0. Audience exclusion (QM-D33) — checked BEFORE any grant, because it is not a grant rule:
  //    a complaint about a person is closed to that person no matter what they hold, oversight
  //    included. Being senior does not put you in the audience of a complaint about you. The
  //    substance reaches them through a named-person conversation recorded on the complaint
  //    (QM-D33's own mechanism), never through the record itself.
  if (resource?.isAboutActor) {
    return deny(
      'This complaint concerns you, so the record is closed to you (QM-D33) — no capability ' +
        'changes that. What you need to hear from it reaches you through a conversation with ' +
        'your manager, which is recorded on the complaint.',
    );
  }

  // 1. Grant.
  const viaOversight = action !== 'view_safeguarding' && holds('oversight');
  if (!holds(action) && !viaOversight) {
    if (action === 'view_safeguarding') {
      return deny(
        "Safeguarding records are named-access (R3-4): they need the explicit 'view_safeguarding' " +
          "grant, and holding 'oversight' deliberately does not imply it.",
      );
    }
    return deny(
      `This identity holds neither '${action}' nor 'oversight', so it cannot ${DOING[action]}.`,
    );
  }

  // 2. The named safeguarding grant, checked against the RESOURCE too — a resolve or an assign
  //    on a safeguarding case is still safeguarding access.
  if (resource?.isSafeguarding && !holds('view_safeguarding')) {
    return deny(
      "This is a safeguarding case (Tier-2). It needs the explicit 'view_safeguarding' grant " +
        "regardless of any other capability — 'oversight' deliberately does not imply it (R3-4).",
    );
  }

  // 3. Scope.
  if (resource?.campusOrgUnitId) {
    const inScope =
      actor.scopeOrgUnitId === GROUP_ROOT_ID ||
      actor.scopeOrgUnitId === resource.campusOrgUnitId;
    if (!inScope && !holds('oversight')) {
      return deny(
        `Out of scope: this identity is scoped to '${actor.scopeOrgUnitId}' and the request ` +
          `belongs to '${resource.campusOrgUnitId}'. Crossing campuses needs the 'oversight' grant.`,
      );
    }
  }

  // 4. Vendor-owner rule. Fails closed when the resource is unnamed: ownership cannot be
  //    checked, so it is not assumed.
  if (actor.isVendor && action === 'resolve' && resource?.isOwnedByActor !== true) {
    return deny(
      resource
        ? 'A vendor may only resolve requests it owns (R3-23) — this one is owned by someone else.'
        : 'A vendor may only resolve requests it owns (R3-23) — name the request so ownership can be checked.',
    );
  }

  return allow(
    holds(action)
      ? `Granted via '${action}'.`
      : `Granted via 'oversight', which implies every action except 'view_safeguarding'.`,
  );
}

/** Verb phrases for deny reasons — read as "…cannot file a request". */
const DOING: Record<Action, string> = {
  view_queue: 'view the queue',
  file: 'file a request',
  assign: 'assign an owner',
  resolve: 'reply to or resolve a request',
  oversight: 'use the cross-campus oversight view',
  triage_approve: 'give a filing its second look',
  view_safeguarding: 'view safeguarding records',
};

// ---------------------------------------------------------------------------------------
// The triage gate (QM-D10): seriousness, and the second pair of eyes.
// ---------------------------------------------------------------------------------------

export const SERIOUSNESS = ['low', 'medium', 'high'] as const;
export type Seriousness = (typeof SERIOUSNESS)[number];

const SERIOUSNESS_RANK: Record<Seriousness, number> = { low: 0, medium: 1, high: 2 };

/**
 * Above this, filing needs a second person (R3-5 maker-checker, threshold-dialled). A seed
 * value exactly like core/sla.ts's targets: CONFIG in the real module, never hardcoded.
 */
export const SECOND_LOOK_THRESHOLD: Seriousness = 'high';

/**
 * In the real module seriousness is a human triage judgment. The prototype derives it
 * deterministically from what filing already captures, so the gate can demo without one more
 * form field: safeguarding is always 'high' (in the real corpus every safety case was also a
 * bus case — a safety complaint is never minor), critical urgency is 'high', high urgency is
 * 'medium', the rest 'low'.
 */
export function derivedSeriousness(args: {
  urgency: string;
  isSafeguarding: boolean;
}): Seriousness {
  if (args.isSafeguarding) return 'high';
  if (args.urgency === 'critical') return 'high';
  if (args.urgency === 'high') return 'medium';
  return 'low';
}

/** Whether this seriousness needs the QM-D10 second look. Unknown/absent values do not. */
export function needsSecondLook(seriousness: string | null | undefined): boolean {
  if (!seriousness || !(seriousness in SERIOUSNESS_RANK)) return false;
  return (
    SERIOUSNESS_RANK[seriousness as Seriousness] >= SERIOUSNESS_RANK[SECOND_LOOK_THRESHOLD]
  );
}

/**
 * DERIVED at read time from stored facts, exactly like overdue (QM-D15's shape): there is no
 * stored pending flag to go stale. And per QM-D10 the pending state NEVER gates the response —
 * replies and resolution proceed while the second look is outstanding; the UI shows a quiet
 * chip, not a lock.
 */
export function pendingSecondLook(req: {
  seriousness: string | null;
  triageApprovedAt: Date | null;
}): boolean {
  return needsSecondLook(req.seriousness) && req.triageApprovedAt === null;
}

/**
 * QM-D10: two-person means two PEOPLE. The filer cannot supply their own second look, no
 * matter what they hold — this is an identity rule, not a grant rule, which is why it is a
 * separate check from can().
 *
 * A null filer (a seeded or system-filed record with no recorded actor) is approvable by
 * anyone holding the grant: the rule needs two people, and an unknown filer cannot be shown
 * to be the same person.
 */
export function secondLook(actorId: string, filedById: string | null | undefined): Decision {
  if (filedById && actorId === filedById) {
    return deny(
      'Two-person means two people (QM-D10): the person who filed this cannot also approve it. ' +
        'Ask someone else holding triage approval for the second look.',
    );
  }
  return allow('A different person from the filer — the second pair of eyes QM-D10 asks for.');
}

/**
 * QM-D32: a complaint routed TO a staff member is ordinary work on their stream — no stigma,
 * no special section. A complaint ABOUT a staff member is the opposite: never their work item.
 * It cannot be routed to, owned by, or resolved by a person it names.
 *
 * Like secondLook, this is an IDENTITY rule, not a grant rule — which is why it is not inside
 * can(): no capability the candidate holds changes whose complaint it is, and can() only ever
 * knows about the ACTOR, not about an arbitrary assignment target.
 */
export function assignableOwner(
  aboutStaffIds: string[],
  candidateId: string,
  /**
   * The candidate's own scope and the request's campus, for the campus rule below. Both come
   * from the DATABASE at the call site, never from the submitted form — the estate rule after
   * route-planning's addStudent took a campus id as a trusted field. Optional only so the
   * about-staff rule can still be checked on its own; when either is absent the campus rule
   * cannot run and does not pretend to.
   */
  candidateScopeOrgUnitId?: string,
  requestCampusOrgUnitId?: string,
): Decision {
  if (aboutStaffIds.includes(candidateId)) {
    return deny(
      'This complaint is about that person, and a complaint about a person is never their work ' +
        'item (QM-D32): it cannot be routed to, owned by, or resolved by them. Choose a ' +
        'different owner.',
    );
  }

  // Feedback #19, 26-Aug-2026: "assign if I'm not in that campus... it should stop from
  // assigning it." Work cannot be handed to someone who has no business in that campus — they
  // cannot open the record they have been made responsible for, so the request would sit owned
  // and untouchable, which is worse than unowned. Group scope is the deliberate exception.
  if (candidateScopeOrgUnitId && requestCampusOrgUnitId) {
    const inScope =
      candidateScopeOrgUnitId === GROUP_ROOT_ID ||
      candidateScopeOrgUnitId === requestCampusOrgUnitId;
    if (!inScope) {
      return deny(
        `That person is scoped to '${candidateScopeOrgUnitId}' and this request belongs to ` +
          `'${requestCampusOrgUnitId}'. They could not open it, so it cannot be their work. ` +
          'Choose someone at this campus, or someone with group scope.',
      );
    }
  }

  return allow('Not someone this complaint is about, and scoped to this campus — assignable.');
}

/**
 * What a LIST row may show of a safeguarding record to this actor. The record page already
 * gates on the named grant; before this existed, the queue and oversight lists leaked the
 * subject line — "child left at the bus stop" names the situation even when the record is
 * closed to you. A list row is the widest surface in the app, so it carries the least.
 *
 * Suppress-the-content, keep-the-row: the row itself stays visible (the desk must see that
 * work EXISTS and is owed a clock), but subject and preview are replaced. This deliberately
 * differs from R3-19's suppress-the-row rule for search — a queue is a work list, and hiding
 * the row would let a safeguarding case sit unworked precisely because nobody could see it.
 */
export function listProjection(
  actor: ActorGrants,
  req: { isSafeguarding: boolean; campusOrgUnitId: string; subject: string; body: string },
): { subject: string; preview: string; masked: boolean } {
  if (!req.isSafeguarding) {
    return { subject: req.subject, preview: req.body, masked: false };
  }
  const view = can(actor, 'view_safeguarding', {
    campusOrgUnitId: req.campusOrgUnitId, isSafeguarding: true,
  });
  if (view.allowed) return { subject: req.subject, preview: req.body, masked: false };
  return {
    subject: 'Safeguarding — named access only',
    preview: 'The subject and content of this record are visible only to holders of the safeguarding grant.',
    masked: true,
  };
}
