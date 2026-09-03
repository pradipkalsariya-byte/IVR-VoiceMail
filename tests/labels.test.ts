import { describe, it, expect } from 'vitest';
import { STATUSES } from '../core/taxonomy';
import { STATUS_LABEL, statusLabel, activityKindLabel, urgencyLabel, humanise, guessedSenderLabel, senderIdentityLabel, senderAddressLabel } from '../core/labels';

// The vocabulary gate: no stored enum may reach a screen as snake_case. Exists because the
// 2026-08-09 UX review found `not_a_request` and `triage_approved` rendering verbatim.
describe('core/labels', () => {
  it('labels every status the schema can store, with no underscores', () => {
    for (const s of STATUSES) {
      expect(STATUS_LABEL[s], `status "${s}" has no label`).toBeTruthy();
      expect(STATUS_LABEL[s]).not.toMatch(/_/);
    }
    expect(statusLabel('not_a_request')).toBe('Not a request');
  });

  it('labels every activity kind the app writes', () => {
    // Kinds as written by app/actions.ts, cluster/chase/claim/family actions, ingestion and seed.
    const kinds = ['filed', 'classified', 'assigned', 'acknowledged', 'replied', 'resolved',
      'reopened', 'note', 'chased', 'conveyed', 'triage_approved'];
    for (const k of kinds) {
      const label = activityKindLabel(k);
      expect(label).not.toMatch(/_/);
      expect(label[0]).toBe(label[0].toUpperCase());
    }
    expect(activityKindLabel('triage_approved')).toBe('Second look approved');
  });

  it('never leaks snake_case even for a kind nobody registered', () => {
    expect(activityKindLabel('some_future_kind')).toBe('Some future kind');
    expect(statusLabel('weird_new_status')).toBe('Weird new status');
    expect(humanise('')).toBe('');
  });

  it('labels urgencies', () => {
    for (const u of ['low', 'normal', 'high', 'critical']) {
      expect(urgencyLabel(u)).toBe(u[0].toUpperCase() + u.slice(1));
    }
  });
});

describe('guessedSenderLabel', () => {
  it('reads "Parent of <child>" off a parent address', () => {
    expect(guessedSenderLabel('p.aarav.shah@fsksurat.in')).toBe('Parent of Aarav Shah');
  });

  it('reads the bare name off a student or alumnus address — they ARE that person', () => {
    expect(guessedSenderLabel('s.diya.mehta@fwgs.in')).toBe('Diya Mehta');
    expect(guessedSenderLabel('a2026.rohan.patel@fsksurat.in')).toBe('Rohan Patel');
  });

  it('returns null for no address, an unrecognised pattern, or off-domain', () => {
    expect(guessedSenderLabel(null)).toBeNull();
    expect(guessedSenderLabel('admissions@fsksurat.in')).toBeNull();
    expect(guessedSenderLabel('p.aarav.shah@gmail.com')).toBeNull();
  });
});

describe('senderIdentityLabel', () => {
  const family = { label: 'Parent of Aarav Shah' };
  const parentEmail = 'p.diya.mehta@fwgs.in';

  it('shows the masked placeholder, never the real identity, when the row is masked', () => {
    const shown = { masked: true, subject: 'Safeguarding — named access only' };
    // The exact regression: a Tier-2 case's real family name, or an address-pattern guess,
    // must never appear next to a masked subject — that would name a child in a safeguarding
    // case to anyone browsing the queue, grant or not.
    expect(senderIdentityLabel(shown, family, parentEmail, 'unknown sender')).toBe(
      'Safeguarding — named access only',
    );
    expect(senderIdentityLabel(shown, family, parentEmail, 'unknown sender')).not.toContain('Aarav');
    expect(senderIdentityLabel(shown, null, parentEmail, 'unknown sender')).not.toContain('Diya');
  });

  it('shows the real identity — family label, then guessed name, then fallback — when unmasked', () => {
    const shown = { masked: false, subject: 'Bus stop moved' };
    expect(senderIdentityLabel(shown, family, parentEmail, 'unknown sender')).toBe('Parent of Aarav Shah');
    expect(senderIdentityLabel(shown, null, parentEmail, 'unknown sender')).toBe('Parent of Diya Mehta');
    expect(senderIdentityLabel(shown, null, null, 'unknown sender')).toBe('unknown sender');
  });
});

describe('senderAddressLabel', () => {
  it('masks in lockstep with the identity — a masked row shows no address at all', () => {
    expect(senderAddressLabel({ masked: true }, 'p.diya.mehta@fwgs.in')).toBeNull();
  });

  it('shows the raw address when unmasked, and null (not empty) when there is none', () => {
    expect(senderAddressLabel({ masked: false }, 'p.diya.mehta@fwgs.in')).toBe('p.diya.mehta@fwgs.in');
    expect(senderAddressLabel({ masked: false }, null)).toBeNull();
    expect(senderAddressLabel({ masked: false }, '')).toBeNull();
  });
});
