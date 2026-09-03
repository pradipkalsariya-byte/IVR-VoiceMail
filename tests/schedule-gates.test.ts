import { describe, expect, it } from 'vitest';
import { automationWanted, filterSet } from '../core/mailboxHealth';

// The three fail-closed gates in front of the five-minute timer. Small predicates, but each
// guards a real failure: a ticking DEMO source fabricates fictional parent mail forever, and
// a ticking UNFILTERED gmail source ingests the member account's entire personal inbox.
describe('automationWanted', () => {
  it('only the real mailbox may tick — the demo source never does', () => {
    expect(automationWanted({ MAIL_SOURCE: 'seed' })).toBe(false);
    expect(automationWanted({})).toBe(false);
    expect(automationWanted({ MAIL_SOURCE: 'gmail' })).toBe(true);
  });

  it('the runbook off-switch works, and only the exact word off', () => {
    expect(automationWanted({ MAIL_SOURCE: 'gmail', MAILBOX_AUTOMATION: 'off' })).toBe(false);
    expect(automationWanted({ MAIL_SOURCE: 'gmail', MAILBOX_AUTOMATION: 'on' })).toBe(true);
  });
});

describe('filterSet', () => {
  it('an unset or blank GMAIL_QUERY reads as no filter — never as "everything"', () => {
    expect(filterSet({})).toBe(false);
    expect(filterSet({ GMAIL_QUERY: '   ' })).toBe(false);
    expect(filterSet({ GMAIL_QUERY: 'deliveredto:frontdesk@fsksurat.in' })).toBe(true);
  });
});
