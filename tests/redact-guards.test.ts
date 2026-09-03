// The guards on what leaves this machine. Their job is to catch what the masker MISSED — and to
// stay quiet about text the masker never claimed, because a guard that fires on ordinary traffic
// is one somebody switches off. Every name below is invented.
import { describe, it, expect } from 'vitest';
import { residualNames, redactBody } from '../core/redact';
import { buildPayload } from '../core/classify-model';

describe('the dash guard claims exactly what DASHED_NAME masks', () => {
  it('flags a name left sitting at the end of a subject', () => {
    expect(residualNames('Exit Pass Notification - Kavya Menon')).toContain('name-after-dash');
  });

  it('flags a name left in front of an already-masked value', () => {
    expect(residualNames('New Form - Kavya Menon («grade»)')).toContain('name-after-dash');
  });

  it('stays quiet on school boilerplate mid-sentence', () => {
    // The two exact shapes that refused 27 of 60 real emails on 26-Aug-2026. Neither is a name.
    expect(residualNames('Exit Pass - New Form filled for «child»'))
      .not.toContain('name-after-dash');
    expect(residualNames('Attendance - Junior School update for «child»'))
      .not.toContain('name-after-dash');
  });
});

describe('routine school mail is sendable, not refused', () => {
  it('accepts a notification whose only capitalised runs are boilerplate', () => {
    const built = buildPayload({
      subject: 'Student Exit Pass - New Form filled',
      body: 'This is an automated notification from the Junior School office.',
    });
    expect('payload' in built).toBe(true);
  });
});

describe('URL redaction survived being renamed off the global constructor', () => {
  it('still masks a link in a body', () => {
    expect(redactBody('see https://example.test/x for details')).toContain('«url»');
  });

  it('leaves the global URL constructor usable', () => {
    // The rename exists for this: a top-level `const URL` shadowed the constructor for every
    // module a bundler flattened into one scope, and read as a network fault.
    expect(new URL('https://example.test/x').host).toBe('example.test');
  });
});
