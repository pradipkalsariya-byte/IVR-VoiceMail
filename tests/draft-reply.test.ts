// A drafted reply is a convenience with teeth: the failure mode is a parent receiving a form
// letter about their child. Every name below is invented.
import { describe, it, expect } from 'vitest';
import {
  shouldDraft, parseDraft, rehydrate, hasPlaceholders, draftPrompt,
} from '../core/draft-reply';

describe('what must never get a drafted reply', () => {
  it('refuses safeguarding, by taxonomy flag rather than by name', () => {
    const d = shouldDraft('child-safety');
    expect(d.draft).toBe(false);
    expect(d.reason).toMatch(/person who has read it/);
  });

  it('refuses complaints that are about a named person', () => {
    expect(shouldDraft('about-other-parent').draft).toBe(false);
    expect(shouldDraft('selection').draft).toBe(false);
  });

  it('refuses when nobody has filed it, and says so plainly', () => {
    expect(shouldDraft(null).draft).toBe(false);
    expect(shouldDraft('unclassified').draft).toBe(false);
  });

  it('offers a draft for routine desk work', () => {
    expect(shouldDraft('fees').draft).toBe(true);
    expect(shouldDraft('certificates').draft).toBe(true);
    expect(shouldDraft('leave-medical').draft).toBe(true);
  });

  it('gives a reason either way — the desk is never just refused', () => {
    for (const c of ['child-safety', 'fees', 'not-a-request', null]) {
      expect(shouldDraft(c).reason.length).toBeGreaterThan(20);
    }
  });
});

describe('the prompt forbids the things a desk cannot promise', () => {
  const p = draftPrompt('Fee query', 'What is my balance?', { category: 'fees', ownerName: 'Priya' });

  it('tells the model not to invent amounts, dates or decisions', () => {
    expect(p).toMatch(/no amounts, no dates, no times, no decisions/);
  });

  it('names who is picking it up', () => {
    expect(p).toContain('Priya');
  });

  it('says the desk will pick it up when nobody is assigned', () => {
    expect(draftPrompt('x', 'y', { category: 'fees' })).toMatch(/Nobody is assigned yet/);
  });
});

describe('a malformed draft is no draft, not a broken one', () => {
  it('accepts a well-formed answer', () => {
    // Built with JSON.stringify rather than hand-escaped. A literal backslash-n typed into the
    // source becomes a REAL newline inside the JSON string — a control character, and therefore
    // invalid JSON. parseDraft rejected that, which is how this test failed the first time: the
    // function was right, the fixture was wrong.
    const answer = JSON.stringify({
      body: 'Thank you for writing in about «child».\nWe will come back to you.',
    });
    expect(parseDraft(answer)).toMatch(/Thank you for writing in/);
  });

  it('survives a stray code fence', () => {
    expect(parseDraft('```json\n{"body":"Thank you for letting us know about «child» today."}\n```'))
      .toMatch(/Thank you/);
  });

  it('rejects prose, wrong shapes, and a one-word answer', () => {
    expect(parseDraft('Sure, here you go!')).toBeNull();
    expect(parseDraft('{"reply":"..."}')).toBeNull();
    expect(parseDraft('{"body":"OK"}')).toBeNull();
  });

  it('rejects an essay — a front desk reply is not 1,500 characters', () => {
    expect(parseDraft(JSON.stringify({ body: 'x'.repeat(1_600) }))).toBeNull();
  });
});

describe('names go back in locally, after the model has answered', () => {
  const draft = 'Thank you for writing about «child». «name», we will follow up today.';

  it('substitutes what the database holds', () => {
    const out = rehydrate(draft, { child: 'Kavya', parent: 'Mrs Menon' });
    expect(out).toBe('Thank you for writing about Kavya. Mrs Menon, we will follow up today.');
    expect(hasPlaceholders(out)).toBe(false);
  });

  it('leaves a placeholder standing when the name is not known', () => {
    // Better than a blank: «child» tells a desk assistant to fill it in, an empty space reads
    // as a finished sentence.
    const out = rehydrate(draft, { child: null, parent: 'Mrs Menon' });
    expect(out).toContain('«child»');
    expect(hasPlaceholders(out)).toBe(true);
  });

  it('replaces every occurrence, not just the first', () => {
    expect(rehydrate('«child» and «child»', { child: 'Kavya' })).toBe('Kavya and Kavya');
  });
});
