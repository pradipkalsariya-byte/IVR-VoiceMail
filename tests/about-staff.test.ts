import { describe, it, expect } from 'vitest';
import { ACTIONS, assignableOwner, can, type ActorGrants } from '../core/permissions';

// Fixture actors mirror the seed's shape (prisma/seed.ts). Synthetic throughout — these are
// grants, not people.

/** Every grant that exists, held at once — the strongest identity the system can express. */
const holdsEverything: ActorGrants = {
  permissions: ['oversight', 'view_safeguarding', ...ACTIONS],
  scopeOrgUnitId: 'group',
  isVendor: false,
};
const frontDeskFsk: ActorGrants = {
  permissions: ['view_queue', 'file', 'assign', 'resolve'],
  scopeOrgUnitId: 'fsk',
  isVendor: false,
};

describe('rule 0 (QM-D33): a complaint about a person is closed to that person', () => {
  it('denies EVERY action to an actor holding every grant, and the reason cites QM-D33', () => {
    for (const action of ACTIONS) {
      const d = can(holdsEverything, action, {
        campusOrgUnitId: 'fsk',
        isAboutActor: true,
      });
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('QM-D33');
      // The reason is written to be argued with, not a code.
      expect(d.reason.length).toBeGreaterThan(40);
    }
  });

  it('outranks the scope check — the deny is the audience one, never the scope one', () => {
    // Out-of-scope AND about-the-actor: without rule 0 firing first, this would read as a
    // scope refusal, inviting "switch identity and try again". The audience reason forecloses
    // that — no identity change puts you in the audience of a complaint about you.
    const d = can(frontDeskFsk, 'file', { campusOrgUnitId: 'fwgs', isAboutActor: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('QM-D33');
    expect(d.reason).not.toContain('Out of scope');
  });

  it('outranks the safeguarding check — the deny is the audience one, not the named-grant one', () => {
    const d = can(frontDeskFsk, 'resolve', {
      campusOrgUnitId: 'fsk',
      isSafeguarding: true,
      isAboutActor: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('QM-D33');
    expect(d.reason).not.toContain("'view_safeguarding'");
  });

  it('false or absent isAboutActor changes nothing — a normal allow still allows', () => {
    expect(can(frontDeskFsk, 'file', { campusOrgUnitId: 'fsk', isAboutActor: false }).allowed).toBe(true);
    expect(can(frontDeskFsk, 'file', { campusOrgUnitId: 'fsk' }).allowed).toBe(true);
    expect(can(holdsEverything, 'oversight').allowed).toBe(true);
  });
});

describe('assignableOwner (QM-D32): a complaint about a person is never their work item', () => {
  it('denies an about-person as owner, and the reason cites QM-D32', () => {
    const d = assignableOwner(['s-lead-fsk', 's-fd-fsk'], 's-lead-fsk');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('QM-D32');
    expect(d.reason).toContain('never their work item');
  });

  it('allows anyone the complaint is not about', () => {
    expect(assignableOwner(['s-lead-fsk'], 's-hos').allowed).toBe(true);
  });

  it('an empty about-list constrains nobody — the ordinary case stays ordinary', () => {
    expect(assignableOwner([], 's-lead-fsk').allowed).toBe(true);
  });
});

// Feedback #19, transcript 00:26:32: "assign if I'm not in that campus... but you have super
// admin — so it should stop from assigning it."
describe('assignableOwner also enforces campus scope (feedback #19)', () => {
  it('refuses someone scoped to another campus', () => {
    const d = assignableOwner([], 's-fd-fwgs', 'fwgs', 'fsk');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/scoped to 'fwgs'/);
    expect(d.reason).toMatch(/could not open it/);
  });

  it('allows someone at the same campus', () => {
    expect(assignableOwner([], 's-fd-fsk', 'fsk', 'fsk').allowed).toBe(true);
  });

  it('allows GROUP scope anywhere — the deliberate exception', () => {
    expect(assignableOwner([], 's-lead', 'group', 'fsk').allowed).toBe(true);
    expect(assignableOwner([], 's-lead', 'group', 'fwgs').allowed).toBe(true);
  });

  it('still refuses the about-person FIRST, even when the campus is right', () => {
    // Ordering matters: the QM-D32 refusal explains itself better than a campus one would,
    // and being at the right campus must never make a complaint about you assignable to you.
    const d = assignableOwner(['s-fd-fsk'], 's-fd-fsk', 'fsk', 'fsk');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/complaint is about that person/);
  });

  it('cannot be bypassed by omitting the campus arguments', () => {
    // The action always passes both, from the database. If a future caller forgets, the
    // about-staff rule still runs — this test exists so that silence is a deliberate choice
    // rather than an accident nobody noticed.
    expect(assignableOwner(['s-x'], 's-x').allowed).toBe(false);
    expect(assignableOwner([], 's-x').allowed).toBe(true);
  });
});
