import { describe, it, expect } from 'vitest';
import {
  buildVoicemailCapture, parseIsoWithOffset, parseVoicemailPayload, resolveVoicemailCampus,
  resolveVoicemailTeam, voicemailSourceMessageId, MAX_AUDIO_BYTES, MAX_DURATION_SECONDS,
  type RawVoicemailPayload, type ValidatedVoicemail,
} from '../core/voicemail';

// SYNTHETIC ONLY (cardinal rule 2): every caller number is from the reserved 9900000xxx block.

const VALID: RawVoicemailPayload = {
  callId: 'call-abc-123',
  callerNumber: '919900000216',
  dialledNumber: '919900001234',
  startedAt: '2026-08-27T14:32:10+05:30',
  durationSeconds: 42,
  audioContentType: 'audio/wav',
  audioSizeBytes: 500_000,
  menu: 'Front Desk',
};

describe('parseVoicemailPayload — the vendor webhook, field by field', () => {
  it('accepts a well-formed payload', () => {
    const parsed = parseVoicemailPayload(VALID);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      callId: 'call-abc-123',
      callerNumber: '919900000216',
      callerPhone: '9900000216',
      dialledNumber: '919900001234',
      startedAt: new Date('2026-08-27T09:02:10.000Z'),
      durationSeconds: 42,
      audioContentType: 'audio/wav',
      audioSizeBytes: 500_000,
      menu: 'Front Desk',
    });
  });

  it('accepts a payload with no menu at all — optional, never rejected', () => {
    const parsed = parseVoicemailPayload({ ...VALID, menu: undefined });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.menu).toBeNull();
  });

  it('rejects a missing callId — the one field that must be right', () => {
    const parsed = parseVoicemailPayload({ ...VALID, callId: '' });
    expect(parsed).toEqual({ ok: false, reason: expect.stringContaining('callId') });
  });

  it('rejects a missing dialledNumber', () => {
    expect(parseVoicemailPayload({ ...VALID, dialledNumber: null }).ok).toBe(false);
  });

  it('rejects startedAt with no timezone offset — a bare local time cannot be trusted', () => {
    const parsed = parseVoicemailPayload({ ...VALID, startedAt: '2026-08-27T14:32:10' });
    expect(parsed).toEqual({ ok: false, reason: expect.stringContaining('timezone offset') });
  });

  it('accepts a Z offset as well as an explicit one', () => {
    expect(parseVoicemailPayload({ ...VALID, startedAt: '2026-08-27T09:02:10Z' }).ok).toBe(true);
  });

  it('rejects a negative or absurdly long duration', () => {
    expect(parseVoicemailPayload({ ...VALID, durationSeconds: -1 }).ok).toBe(false);
    expect(parseVoicemailPayload({ ...VALID, durationSeconds: MAX_DURATION_SECONDS + 1 }).ok).toBe(false);
    expect(parseVoicemailPayload({ ...VALID, durationSeconds: MAX_DURATION_SECONDS }).ok).toBe(true);
  });

  it('rejects an oversized or empty audio file', () => {
    expect(parseVoicemailPayload({ ...VALID, audioSizeBytes: 0 }).ok).toBe(false);
    expect(parseVoicemailPayload({ ...VALID, audioSizeBytes: MAX_AUDIO_BYTES + 1 }).ok).toBe(false);
    expect(parseVoicemailPayload({ ...VALID, audioSizeBytes: MAX_AUDIO_BYTES }).ok).toBe(true);
  });

  it('treats an empty or withheld callerNumber as valid — "say so explicitly", not a rejection', () => {
    const parsed = parseVoicemailPayload({ ...VALID, callerNumber: '' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.callerNumber).toBe('');
      expect(parsed.value.callerPhone).toBeNull();
    }
  });

  it('treats a missing callerNumber field the same as an empty one, not a rejection', () => {
    const parsed = parseVoicemailPayload({ ...VALID, callerNumber: undefined });
    expect(parsed.ok).toBe(true);
  });
});

describe('parseIsoWithOffset', () => {
  it('rejects a bare local time', () => {
    expect(parseIsoWithOffset('2026-08-27T14:32:10')).toBeNull();
  });
  it('accepts an explicit offset', () => {
    expect(parseIsoWithOffset('2026-08-27T14:32:10+05:30')).toEqual(new Date('2026-08-27T09:02:10.000Z'));
  });
  it('rejects garbage', () => {
    expect(parseIsoWithOffset('not a date')).toBeNull();
  });
});

describe('voicemailSourceMessageId — the de-duplication key (brief step 1)', () => {
  it('is deterministic — the same callId always derives the same id', () => {
    expect(voicemailSourceMessageId('call-1')).toBe(voicemailSourceMessageId('call-1'));
  });
  it('lives in its own namespace, distinct from a missed-call row id', () => {
    expect(voicemailSourceMessageId('call-1')).toBe('voicemail-call-1');
    expect(voicemailSourceMessageId('call-1')).not.toMatch(/^missed-call-/);
  });
  it('gives two different calls two different ids', () => {
    expect(voicemailSourceMessageId('call-1')).not.toBe(voicemailSourceMessageId('call-2'));
  });
});

describe('resolveVoicemailCampus', () => {
  const lineToCampus = new Map([['919900001234', 'fsk-id'], ['919900005678', 'fwgs-id']]);

  it('maps a known dialled number to its campus', () => {
    expect(resolveVoicemailCampus('919900001234', lineToCampus, 'fallback-id'))
      .toEqual({ campus: 'fsk-id', how: 'dialled number 919900001234' });
  });

  it('falls back for an unmapped line rather than guessing', () => {
    expect(resolveVoicemailCampus('919900009999', lineToCampus, 'fallback-id'))
      .toEqual({ campus: 'fallback-id', how: 'unmapped line' });
  });
});

describe('resolveVoicemailTeam', () => {
  const menuToTeam = new Map([
    ['front desk', 'frontdesk@fsksurat.in'],
    ['transport', 'transport@fsksurat.in'],
  ]);

  it('maps a known IVR menu to its team, case-insensitively', () => {
    expect(resolveVoicemailTeam('Front Desk', menuToTeam, 'fallback@fsksurat.in'))
      .toEqual({ email: 'frontdesk@fsksurat.in', how: 'IVR menu "Front Desk"' });
    expect(resolveVoicemailTeam('TRANSPORT', menuToTeam, 'fallback@fsksurat.in'))
      .toEqual({ email: 'transport@fsksurat.in', how: 'IVR menu "TRANSPORT"' });
  });

  it('falls back for an unmapped menu rather than guessing', () => {
    expect(resolveVoicemailTeam('Admissions', menuToTeam, 'fallback@fsksurat.in'))
      .toEqual({ email: 'fallback@fsksurat.in', how: 'unmapped menu "Admissions"' });
  });

  it('falls back when the call carried no menu at all', () => {
    expect(resolveVoicemailTeam(null, menuToTeam, 'fallback@fsksurat.in'))
      .toEqual({ email: 'fallback@fsksurat.in', how: 'no menu on the call' });
  });
});

describe('buildVoicemailCapture — the Request-creation fields', () => {
  const v: ValidatedVoicemail = {
    callId: 'call-1',
    callerNumber: '919900000216',
    callerPhone: '9900000216',
    dialledNumber: '919900001234',
    startedAt: new Date('2026-08-27T09:02:10.000Z'),
    durationSeconds: 42,
    audioContentType: 'audio/wav',
    audioSizeBytes: 500_000,
    menu: 'Front Desk',
  };

  it('with no transcript: files unclassified, marked needs-a-listen, never guessing', () => {
    const c = buildVoicemailCapture(v, { campusOrgUnitId: 'fsk-id', transcript: null });
    expect(c.channel).toBe('call');
    expect(c.status).toBe('unfiled');
    expect(c.isSwitchboard).toBe(false);
    expect(c.suggestedCategory).toBe('unclassified');
    expect(c.needsListen).toBe(true);
    expect(c.callerPhone).toBe('9900000216');
    expect(c.sourceMessageId).toBe('voicemail-call-1');
    expect(c.subject).toMatch(/needs a listen/);
    expect(c.arrivedAt).toEqual(v.startedAt);
    expect(+c.clockStartsAt).toBeGreaterThanOrEqual(+c.arrivedAt);
  });

  it('with a transcript: classifies the transcript text, not marked needs-a-listen', () => {
    const c = buildVoicemailCapture(v, {
      campusOrgUnitId: 'fsk-id',
      transcript: 'My daughter is sick today and will not be coming to school.',
    });
    expect(c.needsListen).toBe(false);
    expect(c.body).toBe('My daughter is sick today and will not be coming to school.');
    expect(c.suggestedCategory).toBe('leave-medical');
    expect(c.suggestionReason).toBeTruthy();
  });

  it('a withheld caller still builds a capture, with no phone key and honest wording', () => {
    const withheld: ValidatedVoicemail = { ...v, callerNumber: '', callerPhone: null };
    const c = buildVoicemailCapture(withheld, { campusOrgUnitId: 'fsk-id', transcript: null });
    expect(c.callerPhone).toBeNull();
    expect(c.subject).toMatch(/a withheld number/);
  });

  it('derives a deterministic sourceMessageId so a webhook retry resolves to the same call', () => {
    const first = buildVoicemailCapture(v, { campusOrgUnitId: 'fsk-id', transcript: null });
    const second = buildVoicemailCapture(v, { campusOrgUnitId: 'fsk-id', transcript: null });
    expect(first.sourceMessageId).toBe(second.sourceMessageId);
  });
});
