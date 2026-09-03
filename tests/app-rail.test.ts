import { describe, it, expect } from 'vitest';
import {
  appSubmission, chooseRails, railsLabel, parentStatusLabel, canSendEmailReply, replyPromiseNote,
} from '../core/app-rail';
import { clockStart } from '../core/sla';
import { CATEGORY_KEYS, PARENT_EXCLUDED_KEYS, PARENT_MENU } from '../core/taxonomy';

// 10:30 IST on a Tuesday — the desk is open, so neither clock defers to an opening bell and
// the from-now anchoring is visible directly.
const NOW = new Date('2026-08-04T05:00:00Z');

describe('appSubmission — submission IS filing (QM-D34(5))', () => {
  const sub = appSubmission(NOW, 'transport', {
    subject: 'Request to shift our bus stop',
    body: 'Could the route pause at the society gate instead? Three families use the stop.',
  });

  it('lands open on the app channel with the parent’s category — no unfiled stop, no triage step', () => {
    expect(sub.status).toBe('open');
    expect(sub.channel).toBe('app');
    expect(sub.category).toBe('transport');
  });

  it('anchors BOTH clocks on the submission instant', () => {
    expect(+sub.arrivedAt).toBe(+NOW);
    expect(+sub.clockStartsAt).toBe(+clockStart(NOW));
    expect(+sub.slaDueAt).toBeGreaterThan(+NOW);
    expect(+sub.ackDueAt).toBeGreaterThan(+NOW);
    // The ack target is the tighter clock: a human look is owed before a written answer is.
    expect(+sub.ackDueAt).toBeLessThan(+sub.slaDueAt);
  });

  it('acknowledgedAt stays null — filed is not LOOKED AT (QM-D12 measures the look)', () => {
    expect(sub.acknowledgedAt).toBeNull();
  });

  it('derives seriousness from what submission already captures', () => {
    // transport suggests high urgency; high urgency derives medium seriousness (QM-D10).
    expect(sub.urgency).toBe('high');
    expect(sub.seriousness).toBe('medium');
  });

  it('keeps the parent’s routing even when the classifier disagrees — concierge suggest-only (SD-COM-3)', () => {
    const s = appSubmission(NOW, 'meetings', {
      subject: 'Fee refund question',
      body: 'When is the deposit refund processed?',
    });
    expect(s.category).toBe('meetings');
    expect(s.suggestedCategory).toBe('fees');
    expect(s.suggestionReason.length).toBeGreaterThan(0);
  });

  it('flags safeguarding by CONTENT even when the parent filed it under transport (R3-18)', () => {
    const s = appSubmission(NOW, 'transport', {
      subject: 'Bus stop issue',
      body: 'My child was left unattended at the stop again this morning.',
    });
    expect(s.category).toBe('transport'); // the parent's routing still stands
    expect(s.isSafeguarding).toBe(true);
    expect(s.seriousness).toBe('high');
  });

  it('flags safeguarding by DOOR — choosing the safety category names the situation, whatever the words', () => {
    const s = appSubmission(NOW, 'child-safety', {
      subject: 'A quiet worry',
      body: 'Something at pickup felt wrong; I would rather explain in person.',
    });
    expect(s.isSafeguarding).toBe(true);
    expect(s.seriousness).toBe('high');
  });

  it('an off-menu pick falls to unclassified — never silently adopted, never guessed', () => {
    for (const bad of ['not-a-request', 'unclassified', 'no-such-door', '']) {
      const s = appSubmission(NOW, bad, { subject: 'Hello', body: 'A note.' });
      expect(s.category).toBe('unclassified');
      expect(s.status).toBe('open'); // still filed — the item must LOOK untriaged, not vanish
    }
  });
});

describe('chooseRails — the engine picks, the author never does (QM-D35)', () => {
  it('app where a login exists', () => {
    expect(chooseRails({ hasAppLogin: true, hasEmail: false })).toEqual(['app']);
  });

  it('email fallback where no login exists', () => {
    expect(chooseRails({ hasAppLogin: false, hasEmail: true })).toEqual(['email']);
  });

  it('both when both — the phasing reality: every in-app reply also leaves by email', () => {
    expect(chooseRails({ hasAppLogin: true, hasEmail: true })).toEqual(['app', 'email']);
  });

  it('neither yields an empty set for the caller to surface, never swallow', () => {
    expect(chooseRails({ hasAppLogin: false, hasEmail: false })).toEqual([]);
  });

  it('names the rails the way the trail leg does', () => {
    expect(railsLabel(['app', 'email'])).toBe('in-app + email');
    expect(railsLabel(['app'])).toBe('in-app');
    expect(railsLabel(['email'])).toBe('by email');
    expect(railsLabel([])).toContain('no rail');
  });
});

describe('the parent menu (SD-COM-3) — a deterministic category→door list', () => {
  it('is a subset of CATEGORIES — derived, so the two can never drift', () => {
    for (const m of PARENT_MENU) expect(CATEGORY_KEYS).toContain(m.key);
  });

  it('excludes the internal keys', () => {
    const keys = PARENT_MENU.map(m => m.key);
    for (const k of PARENT_EXCLUDED_KEYS) expect(keys).not.toContain(k);
    // And nothing else was excluded: every non-internal category is a door.
    expect(keys.length).toBe(CATEGORY_KEYS.length - PARENT_EXCLUDED_KEYS.length);
  });

  it('every label is non-empty', () => {
    for (const m of PARENT_MENU) expect(m.label.trim().length).toBeGreaterThan(0);
  });

  it('keeps the safety door on the menu — a parent walks through it directly', () => {
    expect(PARENT_MENU.some(m => m.key === 'child-safety')).toBe(true);
  });
});

describe('parentStatusLabel — the parent face’s whole vocabulary of state', () => {
  it('collapses queue mechanics to whose move it is (QM-D34(1))', () => {
    expect(parentStatusLabel('unfiled')).toBe('With the school');
    expect(parentStatusLabel('open')).toBe('With the school');
    expect(parentStatusLabel('waiting')).toBe('We’ve replied — over to you');
    expect(parentStatusLabel('resolved')).toBe('Resolved');
    expect(parentStatusLabel('not_a_request')).toBe('Closed — no action was needed');
  });
});

describe('canSendEmailReply', () => {
  const emailReq = { channel: 'email', sourceMessageId: '<a@x>', sourceThreadId: 'thr-1' };

  it('is true only for a genuine email-channel request with a real thread and a family email', () => {
    expect(canSendEmailReply(emailReq, 'p@x.test')).toBe(true);
  });

  it('is false without a family email, even on a real email thread', () => {
    expect(canSendEmailReply(emailReq, null)).toBe(false);
    expect(canSendEmailReply(emailReq, undefined)).toBe(false);
  });

  it('is false for a non-email channel even when the linked family has an email — the exact demo-data trap', () => {
    // Every seed fixture family carries an emailKey; an app/call/walkin request linked to one
    // must not attempt a threaded send it has no real Message-ID/threadId for.
    expect(canSendEmailReply({ channel: 'app', sourceMessageId: null, sourceThreadId: null }, 'family01@example.test')).toBe(false);
    expect(canSendEmailReply({ channel: 'call', sourceMessageId: 'missed-call-9900000123-2026-08-12T10:00:00.000Z', sourceThreadId: null }, 'family01@example.test')).toBe(false);
  });

  it('is false for an email-channel request missing either id — a partially-formed record, not a real thread', () => {
    expect(canSendEmailReply({ channel: 'email', sourceMessageId: null, sourceThreadId: 'thr-1' }, 'p@x.test')).toBe(false);
    expect(canSendEmailReply({ channel: 'email', sourceMessageId: '<a@x>', sourceThreadId: null }, 'p@x.test')).toBe(false);
  });
});

describe('replyPromiseNote', () => {
  it('names both rails, and the school address, outside the pilot', () => {
    expect(replyPromiseNote({ rails: ['app', 'email'], canSendEmail: true, pilotReviewerEmail: null }))
      .toBe('Reaches the family in-app + email, from the school’s address.');
  });

  it('never claims email reaches the family when canSendEmail is false, even if chooseRails said email', () => {
    // The exact case chooseRails alone gets wrong: a family carries an email, but this specific
    // request (app/call channel) has no real thread — email did not become sendable just
    // because the rail array contains the word.
    expect(replyPromiseNote({ rails: ['app', 'email'], canSendEmail: false, pilotReviewerEmail: null }))
      .toBe('Reaches the family in-app.');
    expect(replyPromiseNote({ rails: ['email'], canSendEmail: false, pilotReviewerEmail: null }))
      .toBe('No rail is available for this sender — no app login, no email on record. The trail will say so honestly.');
  });

  it('says exactly where email goes during the pilot, and names the reviewer', () => {
    const note = replyPromiseNote({ rails: ['email'], canSendEmail: true, pilotReviewerEmail: 'richa.panchal@fsksurat.in' });
    expect(note).toContain('richa.panchal@fsksurat.in');
    expect(note).toContain('not the family');
  });

  it('tells staff in-app is unaffected by pilot mode when both rails apply', () => {
    const note = replyPromiseNote({ rails: ['app', 'email'], canSendEmail: true, pilotReviewerEmail: 'richa.panchal@fsksurat.in' });
    expect(note).toContain('In-app still reaches the family directly');
  });

  it('a null pilotReviewerEmail (pilot off, or on but unconfigured) never redirects the message', () => {
    expect(replyPromiseNote({ rails: ['email'], canSendEmail: true, pilotReviewerEmail: null }))
      .not.toContain('PILOT');
  });
});
