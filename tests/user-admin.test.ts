// Feedback #34 — the users screen that replaces "a developer runs a script".
import { describe, it, expect } from 'vitest';
import {
  userAdminEmails, canAdministerUsers, validateGrant, safeguardingWarning, ROLE_PRESETS,
} from '../core/user-admin';

const CAMPUSES = ['fsk', 'fwgs', 'fsm', 'falh'];
const grant = (over: Partial<Parameters<typeof validateGrant>[0]> = {}) => validateGrant({
  email: 'smita.henry@fountainheadschools.org', name: 'Smita Henry',
  roleLabel: 'Front Desk', scopeOrgUnitId: 'fsk', campusOrgUnitIds: ['fsk'],
  permissions: ['view_queue', 'file'], ...over,
}, CAMPUSES);

describe('who may curate access', () => {
  it('fails CLOSED to VK when the env var is unset', () => {
    expect(userAdminEmails({})).toEqual(['vardan.kabra@fountainheadschools.org']);
  });

  it('does not fall open to everyone when unset', () => {
    expect(canAdministerUsers('anyone@fountainheadschools.org', {})).toBe(false);
  });

  it('reads a comma-separated list, case and space insensitive', () => {
    const env = { USER_ADMIN_EMAILS: ' VK@fsksurat.in , richa.panchal@fsksurat.in ' };
    expect(canAdministerUsers('vk@fsksurat.in', env)).toBe(true);
    expect(canAdministerUsers('RICHA.PANCHAL@fsksurat.in', env)).toBe(true);
    expect(canAdministerUsers('someone.else@fsksurat.in', env)).toBe(false);
  });

  it('refuses an empty or missing email outright', () => {
    expect(canAdministerUsers(null, {})).toBe(false);
    expect(canAdministerUsers('', {})).toBe(false);
  });
});

describe('what may be granted', () => {
  it('accepts a well-formed grant', () => {
    expect(grant().ok).toBe(true);
  });

  it('refuses an address that could never sign in', () => {
    const r = grant({ email: 'someone@gmail.com' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/not a school domain/);
  });

  it('accepts every school domain, not just the primary one', () => {
    expect(grant({ email: 'trusha.thakkar@fsmsurat.in' }).ok).toBe(true);
    expect(grant({ email: 'someone@fwgs.in' }).ok).toBe(true);
  });

  it('refuses a campus this desk does not cover', () => {
    const r = grant({ scopeOrgUnitId: 'atlantis' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/not a campus/);
  });

  it('accepts group scope', () => {
    expect(grant({ scopeOrgUnitId: 'group' }).ok).toBe(true);
  });

  it('refuses an unknown capability — a server action is a public endpoint', () => {
    const r = grant({ permissions: ['view_queue', 'delete_everything'] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/Unknown capability/);
  });

  it('refuses a grant with NO capability — that is stuck, not restricted', () => {
    const r = grant({ permissions: [] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/at least one capability/);
  });

  it('requires a name, because the audit trail records a person', () => {
    expect(grant({ name: '   ' }).ok).toBe(false);
  });

  it('refuses a malformed address', () => {
    expect(grant({ email: 'not-an-address' }).ok).toBe(false);
  });
});

describe('safeguarding is named-access', () => {
  it('warns when the grant includes it', () => {
    expect(safeguardingWarning(['view_queue', 'view_safeguarding'])).toMatch(/named-access/);
  });

  it('says nothing when it does not', () => {
    expect(safeguardingWarning(['view_queue', 'file'])).toBeNull();
  });

  it('is not in any preset except the safeguarding one', () => {
    const withIt = ROLE_PRESETS.filter(p => p.permissions.includes('view_safeguarding'));
    expect(withIt.map(p => p.key)).toEqual(['safeguarding']);
  });
});

describe('multi-campus grants are checked on the server, not just in the form', () => {
  // A server action is a public endpoint. Anyone signed in can post to it, so the form is not
  // the boundary — this function is.
  it('accepts several real campuses', () => {
    expect(grant({ campusOrgUnitIds: ['fsk', 'fwgs'] }).ok).toBe(true);
  });

  it('accepts group scope', () => {
    expect(grant({ campusOrgUnitIds: ['group'] }).ok).toBe(true);
  });

  it('refuses a campus that does not exist, and names it', () => {
    const r = grant({ campusOrgUnitIds: ['fsk', 'atlantis'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('atlantis');
  });

  it('accepts an empty list — added but not yet given a campus is a real state', () => {
    // They can sign in and see nothing. That is better than refusing to save the person at all,
    // which is what forces an engineer back into the loop.
    expect(grant({ campusOrgUnitIds: [] }).ok).toBe(true);
  });
});
