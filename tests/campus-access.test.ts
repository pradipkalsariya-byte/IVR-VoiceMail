// Multi-campus rights. The failure that matters here is FAIL-OPEN: giving somebody more than
// they were granted, quietly. Every campus id below is one of the app's own codes.
import { describe, it, expect } from 'vitest';
import {
  accessibleCampusIds, canReachCampus, describeGrants, grantsFromLegacyScope,
  hasGroupScope, normaliseGrants, resolveCampus,
} from '../core/campus-access';

const ALL = ['falh', 'fsk', 'fsm', 'fwgs'];
const at = (...ids: Array<string | null>) => ids.map(campusOrgUnitId => ({ campusOrgUnitId }));

describe('what a person can reach', () => {
  it('gives exactly the campuses granted, and no more', () => {
    expect(accessibleCampusIds(at('fsk', 'fwgs'), ALL)).toEqual(['fsk', 'fwgs']);
  });

  it('gives every campus for a group grant', () => {
    expect(accessibleCampusIds(at(null), ALL)).toEqual(['falh', 'fsk', 'fsm', 'fwgs']);
  });

  it('a group grant follows campuses added later — that is what it means', () => {
    expect(accessibleCampusIds(at(null), [...ALL, 'fpv'])).toContain('fpv');
  });

  it('a named grant does NOT follow a new campus', () => {
    // The whole reason this table exists: `group` was the only way to hold two campuses, and it
    // silently enrolled you in every future one.
    expect(accessibleCampusIds(at('fsk', 'fwgs'), [...ALL, 'fpv'])).not.toContain('fpv');
  });

  it('ignores a grant to a campus that no longer exists', () => {
    expect(accessibleCampusIds(at('fsk', 'closed-campus'), ALL)).toEqual(['fsk']);
  });

  it('returns nothing for somebody granted nothing', () => {
    expect(accessibleCampusIds([], ALL)).toEqual([]);
    expect(canReachCampus([], 'fsk', ALL)).toBe(false);
  });

  it('is stably ordered, so two calls in one render agree', () => {
    expect(accessibleCampusIds(at('fwgs', 'fsk'), ALL))
      .toEqual(accessibleCampusIds(at('fsk', 'fwgs'), ALL));
  });
});

describe('choosing the campus a request is for', () => {
  it('honours what was asked for when it is held', () => {
    expect(resolveCampus('fwgs', at('fsk', 'fwgs'), ALL))
      .toEqual({ campusOrgUnitId: 'fwgs', switchedAway: false });
  });

  it('SAYS SO when it silently narrows to one they hold', () => {
    // Narrowing without saying so is how somebody spends ten minutes wondering where their
    // work went.
    expect(resolveCampus('fsm', at('fsk'), ALL))
      .toEqual({ campusOrgUnitId: 'fsk', switchedAway: true });
  });

  it('does not claim a switch when nothing was asked for', () => {
    expect(resolveCampus(null, at('fsk'), ALL))
      .toEqual({ campusOrgUnitId: 'fsk', switchedAway: false });
  });

  it('returns null rather than guessing when they hold nothing', () => {
    expect(resolveCampus('fsk', [], ALL))
      .toEqual({ campusOrgUnitId: null, switchedAway: false });
  });
});

describe('the legacy single scope resolves identically', () => {
  it('turns group into a group grant', () => {
    expect(hasGroupScope(grantsFromLegacyScope('group'))).toBe(true);
  });

  it('turns one campus into one grant', () => {
    expect(accessibleCampusIds(grantsFromLegacyScope('fsk'), ALL)).toEqual(['fsk']);
  });
});

describe('what gets stored', () => {
  it('collapses group + named campuses to just group', () => {
    // Not wrong, but meaningless — and a later reader cannot tell whether the named ones were
    // meant as a restriction.
    expect(normaliseGrants(at(null, 'fsk'))).toEqual([{ campusOrgUnitId: null }]);
  });

  it('drops duplicates', () => {
    expect(normaliseGrants(at('fsk', 'fsk'))).toEqual([{ campusOrgUnitId: 'fsk' }]);
  });
});

describe('what the access screen says out loud', () => {
  const name = (id: string) => ({ fsk: 'FSK', fwgs: 'FWGS', fsm: 'FSM' }[id] ?? id);

  it('spells out that group scope includes future campuses', () => {
    expect(describeGrants(at(null), name)).toMatch(/added later/);
  });

  it('lists campuses readably', () => {
    expect(describeGrants(at('fsk', 'fwgs', 'fsm'), name)).toBe('FSK, FSM and FWGS');
  });

  it('says plainly when somebody holds nothing', () => {
    expect(describeGrants([], name)).toBe('no campuses yet');
  });
});
