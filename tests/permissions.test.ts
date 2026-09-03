import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  can,
  derivedSeriousness,
  needsSecondLook,
  pendingSecondLook,
  secondLook,
  type ActorGrants,
} from '../core/permissions';

// Fixture actors mirror the seed's shape (prisma/seed.ts). Synthetic throughout — the NATO
// naming convention applies to identities; these are grants, not people.
const frontDeskFsk: ActorGrants = {
  permissions: ['view_queue', 'file', 'assign', 'resolve'],
  scopeOrgUnitId: 'fsk',
  isVendor: false,
};
const campusLeadFsk: ActorGrants = {
  permissions: ['view_queue', 'file', 'assign', 'resolve', 'triage_approve'],
  scopeOrgUnitId: 'fsk',
  isVendor: false,
};
/** The Founder shape: 'oversight' and nothing else — QM-D9/D26's seed shorthand. */
const founder: ActorGrants = { permissions: ['oversight'], scopeOrgUnitId: 'group', isVendor: false };
/** The ONE named safeguarding holder. */
const safeguardingLead: ActorGrants = {
  permissions: ['oversight', 'view_safeguarding'],
  scopeOrgUnitId: 'group',
  isVendor: false,
};
const vendor: ActorGrants = {
  permissions: ['view_queue', 'resolve'],
  scopeOrgUnitId: 'group',
  isVendor: true,
};
const nobody: ActorGrants = { permissions: [], scopeOrgUnitId: 'fsk', isVendor: false };

describe('every deny carries a reason — never a bare false', () => {
  it('an actor with no grants is denied every action, each with a plain-language reason', () => {
    for (const action of ACTIONS) {
      const d = can(nobody, action);
      expect(d.allowed).toBe(false);
      expect(d.reason.length).toBeGreaterThan(20);
    }
  });

  it('allows also explain themselves, so a surprising grant can be argued with', () => {
    const d = can(frontDeskFsk, 'file');
    expect(d.allowed).toBe(true);
    expect(d.reason).toContain('file');
  });

  it('names the missing grant in the deny', () => {
    const d = can(frontDeskFsk, 'triage_approve');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("'triage_approve'");
  });
});

describe('scope: campus must match, unless the actor holds oversight', () => {
  it('a campus-scoped actor works their own campus', () => {
    expect(can(frontDeskFsk, 'file', { campusOrgUnitId: 'fsk' }).allowed).toBe(true);
  });

  it('a campus-scoped actor is refused another campus, and the reason names both units', () => {
    const d = can(frontDeskFsk, 'file', { campusOrgUnitId: 'fwgs' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("'fsk'");
    expect(d.reason).toContain("'fwgs'");
  });

  it("'oversight' crosses campuses — that is what the grant is for", () => {
    expect(can(founder, 'resolve', { campusOrgUnitId: 'falh' }).allowed).toBe(true);
  });

  it('the GROUP root sees every campus (scope cascade, R3 §6)', () => {
    // The seed's Accounts posting: group-scoped, no oversight grant.
    const accounts: ActorGrants = { permissions: ['view_queue', 'resolve'], scopeOrgUnitId: 'group', isVendor: false };
    expect(can(accounts, 'resolve', { campusOrgUnitId: 'fsm', isOwnedByActor: true }).allowed).toBe(true);
  });
});

describe("safeguarding is a NAMED grant (R3-4): 'oversight' does not imply it", () => {
  it('an oversight holder WITHOUT the grant is denied the safeguarding view', () => {
    const d = can(founder, 'view_safeguarding', { campusOrgUnitId: 'fsk', isSafeguarding: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("'view_safeguarding'");
    expect(d.reason.toLowerCase()).toContain('oversight');
  });

  it('an oversight holder cannot even RESOLVE a safeguarding case without the named grant', () => {
    const d = can(founder, 'resolve', { campusOrgUnitId: 'fsk', isSafeguarding: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("'view_safeguarding'");
  });

  it('the named holder is allowed, including cross-campus via oversight', () => {
    expect(can(safeguardingLead, 'view_safeguarding', { campusOrgUnitId: 'fwgs', isSafeguarding: true }).allowed).toBe(true);
    expect(can(safeguardingLead, 'resolve', { campusOrgUnitId: 'fwgs', isSafeguarding: true }).allowed).toBe(true);
  });

  it('a front desk actor in scope is still refused a safeguarding case — scope is not need-to-know', () => {
    const d = can(frontDeskFsk, 'file', { campusOrgUnitId: 'fsk', isSafeguarding: true });
    expect(d.allowed).toBe(false);
  });
});

describe('vendors resolve only what they own (R3-23)', () => {
  it('a vendor resolves its own request', () => {
    expect(can(vendor, 'resolve', { campusOrgUnitId: 'falh', isOwnedByActor: true }).allowed).toBe(true);
  });

  it("a vendor is refused someone else's request, with the ownership reason", () => {
    const d = can(vendor, 'resolve', { campusOrgUnitId: 'falh', isOwnedByActor: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('own');
  });

  it('fails closed when the resource is unnamed — ownership cannot be checked, so it is not assumed', () => {
    expect(can(vendor, 'resolve').allowed).toBe(false);
  });

  it('the vendor rule bites vendors only — school staff resolve unowned requests freely', () => {
    expect(can(frontDeskFsk, 'resolve', { campusOrgUnitId: 'fsk', isOwnedByActor: false }).allowed).toBe(true);
  });
});

describe('the two-person rule (QM-D10): two people, not two clicks', () => {
  it('rejects self-approval even for a grant holder', () => {
    const d = secondLook('s-lead-fsk', 's-lead-fsk');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('Two-person');
  });

  it('accepts a different person', () => {
    expect(secondLook('s-lead-fsk', 's-fd-fsk').allowed).toBe(true);
  });

  it('a record with no recorded filer is approvable — an unknown filer cannot be shown to be the same person', () => {
    expect(secondLook('s-lead-fsk', null).allowed).toBe(true);
  });
});

describe('seriousness and the second look', () => {
  it('derives high for safeguarding regardless of urgency — a safety complaint is never minor', () => {
    expect(derivedSeriousness({ urgency: 'low', isSafeguarding: true })).toBe('high');
  });

  it('maps urgency: critical→high, high→medium, normal/low→low', () => {
    expect(derivedSeriousness({ urgency: 'critical', isSafeguarding: false })).toBe('high');
    expect(derivedSeriousness({ urgency: 'high', isSafeguarding: false })).toBe('medium');
    expect(derivedSeriousness({ urgency: 'normal', isSafeguarding: false })).toBe('low');
    expect(derivedSeriousness({ urgency: 'low', isSafeguarding: false })).toBe('low');
  });

  it('only high needs the second look at the seed threshold', () => {
    expect(needsSecondLook('high')).toBe(true);
    expect(needsSecondLook('medium')).toBe(false);
    expect(needsSecondLook('low')).toBe(false);
  });

  it('absent or unknown seriousness never demands approval — old rows do not jam the gate', () => {
    expect(needsSecondLook(null)).toBe(false);
    expect(needsSecondLook(undefined)).toBe(false);
    expect(needsSecondLook('extreme')).toBe(false);
  });

  it('pending is DERIVED from stored facts (QM-D15 shape), and clears on approval', () => {
    expect(pendingSecondLook({ seriousness: 'high', triageApprovedAt: null })).toBe(true);
    expect(pendingSecondLook({ seriousness: 'high', triageApprovedAt: new Date() })).toBe(false);
    expect(pendingSecondLook({ seriousness: 'low', triageApprovedAt: null })).toBe(false);
  });
});

describe('the approval never gates the response (QM-D10)', () => {
  it('resolve is allowed on an unapproved high-seriousness request', () => {
    // The request: filed high-seriousness, second look still pending.
    const req = { seriousness: 'high', triageApprovedAt: null, campusOrgUnitId: 'fsk', isSafeguarding: false };
    expect(pendingSecondLook(req)).toBe(true);
    // …and the capability check neither knows nor cares: ResourceRef carries no triage state,
    // so a resolve gate on pending approval is IMPOSSIBLE to express here. That is the design.
    const d = can(frontDeskFsk, 'resolve', {
      campusOrgUnitId: req.campusOrgUnitId,
      isSafeguarding: req.isSafeguarding,
      isOwnedByActor: false,
    });
    expect(d.allowed).toBe(true);
  });
});
