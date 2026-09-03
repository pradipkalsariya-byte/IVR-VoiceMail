import { describe, expect, it } from 'vitest';
import {
  gmailThreadUrl, gmailThreadUrlFromRequest, isMailLedgerOutcome, LEDGER_OUTCOME_LABEL,
  ledgerOutcomeLabel, ledgerOutcomeTone, MAIL_LEDGER_OUTCOMES,
} from '../core/mailLedger';

describe('mail ledger vocabulary', () => {
  it('every outcome has a label and a tone — the vocabulary is closed and total', () => {
    for (const o of MAIL_LEDGER_OUTCOMES) {
      expect(LEDGER_OUTCOME_LABEL[o]).toBeTruthy();
      expect(['success', 'warning', 'danger', 'outline']).toContain(ledgerOutcomeTone(o));
    }
  });

  it('an unknown stored outcome shows itself rather than crashing', () => {
    expect(isMailLedgerOutcome('future_word')).toBe(false);
    expect(ledgerOutcomeLabel('future_word')).toBe('future_word');
    expect(ledgerOutcomeTone('future_word')).toBe('outline');
  });
});

describe('gmailThreadUrl', () => {
  it('links only the real source — a demo thread id must never produce a link', () => {
    expect(gmailThreadUrl('gmail', 'abc123')).toBe('https://mail.google.com/mail/u/0/#all/abc123');
    expect(gmailThreadUrl('demo', 'demo-thr-1')).toBeNull();
    expect(gmailThreadUrl('gmail', null)).toBeNull();
  });
});

describe('gmailThreadUrlFromRequest', () => {
  it('decides by data shape — long hex is Gmail, every fixture slug is not', () => {
    expect(gmailThreadUrlFromRequest('198f2ab34cd56e78')).toBe(
      'https://mail.google.com/mail/u/0/#all/198f2ab34cd56e78',
    );
    // The exact live catch (24-Aug): '<app-fixture-…' rows classified as gmail rendered an
    // Open-in-Gmail link on fabricated mail. Slug-shaped ids must never link.
    expect(gmailThreadUrlFromRequest('app-thr-fixture-1')).toBeNull();
    expect(gmailThreadUrlFromRequest('demo-thr-3')).toBeNull();
    expect(gmailThreadUrlFromRequest('t-x9k2m4')).toBeNull();
    expect(gmailThreadUrlFromRequest(null)).toBeNull();
  });
});
