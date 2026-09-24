// core/voicemail.ts — IVR voicemail capture ("press 2 to leave a message"). PURE.
//
// The BACKLOG's ready item: docs/IVR-VOICEMAIL-BRIEF.md specified this endpoint's field list
// and de-duplication rule on 27-Aug-2026; nothing existed until now. This module is the pure
// half — validating what the PBX sends and building the capture record — mirroring
// core/missed-calls.ts's MissedCallCapture: same channel ('call'), same 'unfiled' status, same
// stance that NOTHING auto-enters the working queue. The I/O (the webhook, the transcription
// call, the write) lives in app/api/voicemail/route.ts.
//
// The one field that must be right is callId (brief, step 1): "the de-duplication key ... a
// redelivery that creates a duplicate record is the single most annoying failure mode in this
// whole pipe." voicemailSourceMessageId reuses Request.sourceMessageId — the SAME unique
// column and the SAME idempotency mechanism the email and missed-call channels already use,
// rather than inventing a second one.

import { normalisePhone } from './phone';
import { getClassifier } from './classify';
import { parseIstDateTime } from './missed-calls';
import { addWorkingHours, clockStart, slaDue } from './sla';
import type { Urgency } from './taxonomy';

/** The prefix that keeps a voicemail's derived id in its own namespace, distinct from
 *  `missed-call-...` — both live in the same Request.sourceMessageId unique column. */
const PREFIX = 'voicemail-';

/** Deterministic de-duplication key: the PBX's own callId and nothing else (brief step 1). */
export function voicemailSourceMessageId(callId: string): string {
  return `${PREFIX}${callId}`;
}

/** 60-90s is what the brief expects for a VOICEMAIL MESSAGE; this is headroom, not a target —
 *  a live PBX clock can run long, and rejecting a genuine long message loses a family's call
 *  outright. Used only by the old multipart voicemail-only path below. */
export const MAX_DURATION_SECONDS = 600;

/** The real vendor webhook (below) covers EVERY call, not just voicemail messages — an
 *  "Answered" call can legitimately run an hour. This is a sanity ceiling against garbage
 *  data, not a model of how long a message should be; see MAX_DURATION_SECONDS for that. */
export const MAX_CALL_DURATION_SECONDS = 6 * 60 * 60;

/** A 10-minute mono call at a generous bitrate should be nowhere near this — the cap exists to
 *  bound one webhook POST, not to model any particular vendor's real output size. */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const str = (x: unknown): string | null => (typeof x === 'string' ? x.trim() : null);

/** `2026-08-27T14:32:10+05:30` — an explicit offset or `Z` is required; a bare local time
 *  cannot be trusted the way core/missed-calls.ts already found for the Synapse feed. */
export function parseIsoWithOffset(value: string): Date | null {
  if (!/(?:[+-]\d{2}:?\d{2}|Z)$/.test(value.trim())) return null;
  const d = new Date(value);
  return Number.isNaN(+d) ? null : d;
}

/** Raw fields as they arrive off a multipart/form-data POST — every value a string (or
 *  unknown, for a field the caller never sent) until validated. */
export interface RawVoicemailPayload {
  callId: unknown;
  callerNumber: unknown;
  dialledNumber: unknown;
  startedAt: unknown;
  durationSeconds: unknown;
  audioContentType: unknown;
  audioSizeBytes: unknown;
  /** The IVR menu option the caller pressed before voicemail ("Front Desk", "Transport", …) —
   *  YOCC/Enjay's own dashboard already shows this per call. NOT in the original brief's field
   *  table; a real vendor conversation still needs to confirm the exact field name and values.
   *  Optional: an unset menu falls back to a single default team, never a rejected payload. */
  menu: unknown;
}

export interface ValidatedVoicemail {
  callId: string;
  /** Raw CLI as sent, unmodified (brief: "unmodified — this is how we match the call to a
   *  family"). Empty string means withheld — the vendor's own get-out, not ours to reject. */
  callerNumber: string;
  /** Last-10-digits form, or null when withheld / too short to be a real number. */
  callerPhone: string | null;
  dialledNumber: string;
  startedAt: Date;
  durationSeconds: number;
  audioContentType: string;
  audioSizeBytes: number;
  /** As the vendor sent it, verbatim ("Front Desk", "Transport"), or null when absent. */
  menu: string | null;
}

/**
 * Validate one webhook POST. A failure here is a 4xx (brief: "do not retry") — the payload
 * itself is wrong, and retrying the same bytes will not fix that.
 */
export function parseVoicemailPayload(x: RawVoicemailPayload): Parsed<ValidatedVoicemail> {
  const callId = str(x.callId);
  if (!callId) return { ok: false, reason: 'callId is required — it is the de-duplication key.' };

  const dialledNumber = str(x.dialledNumber);
  if (!dialledNumber) return { ok: false, reason: 'dialledNumber is required.' };

  const startedAtRaw = str(x.startedAt);
  const startedAt = startedAtRaw ? parseIsoWithOffset(startedAtRaw) : null;
  if (!startedAt) {
    return {
      ok: false,
      reason: 'startedAt must be ISO 8601 with a timezone offset, e.g. 2026-08-27T14:32:10+05:30.',
    };
  }

  const durationSeconds = typeof x.durationSeconds === 'number'
    ? x.durationSeconds
    : Number(str(x.durationSeconds));
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > MAX_DURATION_SECONDS) {
    return { ok: false, reason: `durationSeconds must be a number between 0 and ${MAX_DURATION_SECONDS}.` };
  }

  const audioContentType = str(x.audioContentType);
  if (!audioContentType) return { ok: false, reason: 'The audio file is required.' };

  const audioSizeBytes = typeof x.audioSizeBytes === 'number' ? x.audioSizeBytes : NaN;
  if (!Number.isFinite(audioSizeBytes) || audioSizeBytes <= 0) {
    return { ok: false, reason: 'The audio file is empty.' };
  }
  if (audioSizeBytes > MAX_AUDIO_BYTES) {
    return { ok: false, reason: `The audio file is over ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB.` };
  }

  // Required as a FIELD (brief's table), not as non-empty content — "Empty/withheld is fine,
  // say so explicitly" is the vendor's own get-out, and a missing field is treated the same as
  // an empty one rather than rejected, since not every PBX will bother sending an empty string.
  const callerNumber = str(x.callerNumber) ?? '';
  const callerPhone = callerNumber ? normalisePhone(callerNumber) : null;
  const menu = str(x.menu);

  return {
    ok: true,
    value: {
      callId, callerNumber, callerPhone, dialledNumber, startedAt, durationSeconds,
      audioContentType, audioSizeBytes, menu,
    },
  };
}

/**
 * Which campus a dialled line belongs to. A real per-line config, unlike core/ingest.ts's
 * missed-call destination guess (a 4-digit extension with no real mapping yet, documented there
 * as "CONFIG in the real module") — the voicemail webhook gives us the actual dialled NUMBER, so
 * a real number → campus map is the honest thing to build, not a placeholder.
 */
export function resolveVoicemailCampus(
  dialledNumber: string,
  lineToCampus: ReadonlyMap<string, string>,
  fallbackCampus: string,
): { campus: string; how: string } {
  const hit = lineToCampus.get(dialledNumber.trim());
  return hit ? { campus: hit, how: `dialled number ${dialledNumber}` } : { campus: fallbackCampus, how: 'unmapped line' };
}

/**
 * Which team mailbox a voicemail's IVR menu selection routes to (YOCC/Enjay's own dashboard
 * already labels each call "Front Desk", "Transport", etc.). Matched case-insensitively — the
 * vendor's own casing is not something we control, and a menu label that differs only in case
 * must not silently fall through to the default team.
 */
export function resolveVoicemailTeam(
  menu: string | null,
  menuToTeam: ReadonlyMap<string, string>,
  fallbackTeamEmail: string,
): { email: string; how: string } {
  const key = menu?.trim().toLowerCase();
  const hit = key ? menuToTeam.get(key) : undefined;
  return hit
    ? { email: hit, how: `IVR menu "${menu}"` }
    : { email: fallbackTeamEmail, how: menu ? `unmapped menu "${menu}"` : 'no menu on the call' };
}

export interface VoicemailCapture {
  channel: 'call';
  subject: string;
  body: string;
  campusOrgUnitId: string;
  arrivedAt: Date;
  clockStartsAt: Date;
  slaDueAt: Date;
  sourceMessageId: string;
  callerPhone: string | null;
  isSwitchboard: false;
  status: 'unfiled';
  urgency: Urgency;
  suggestedCategory: string;
  suggestedUrgency: Urgency;
  suggestionReason: string;
  /** Whether a person still needs to actually LISTEN to the recording — true whenever
   *  transcription did not produce usable text (brief step 2: "transcription failure must
   *  never lose the call"). Never inferred from the body text at render time. */
  needsListen: boolean;
}

/**
 * Build the Request-creation fields for one voicemail. PURE — classification (`rules`) is
 * deterministic and side-effect-free, exactly as core/ingest.ts already calls it inline;
 * transcription is NOT pure (it may call out to a network provider) and is therefore never
 * called from here — the caller passes in whatever transcript it already has, or none.
 */
export function buildVoicemailCapture(
  v: ValidatedVoicemail,
  ctx: { campusOrgUnitId: string; transcript: string | null; classifierName?: string },
): VoicemailCapture {
  const arrivedAt = v.startedAt;
  const callerLabel = v.callerNumber || 'a withheld number';

  if (ctx.transcript) {
    const sug = getClassifier(ctx.classifierName ?? 'rules').classify({
      subject: 'Voicemail', body: ctx.transcript, senderIsKnownFamily: false,
    });
    return {
      channel: 'call',
      subject: `Voicemail from ${callerLabel}`,
      body: ctx.transcript,
      campusOrgUnitId: ctx.campusOrgUnitId,
      arrivedAt,
      clockStartsAt: clockStart(arrivedAt),
      slaDueAt: slaDue(arrivedAt, sug.urgency),
      sourceMessageId: voicemailSourceMessageId(v.callId),
      callerPhone: v.callerPhone,
      isSwitchboard: false,
      status: 'unfiled',
      urgency: sug.urgency,
      suggestedCategory: sug.category,
      suggestedUrgency: sug.urgency,
      suggestionReason: sug.reason,
      needsListen: false,
    };
  }

  // No transcript — transcription is not wired yet (core/transcribe.ts's default provider), or
  // it failed on this particular call. Never guess a category from silence: the honest
  // suggestion is the same 'unclassified' + "needs a person to read it" default every other
  // unmatched capture gets, plus the audio itself so a person can actually listen.
  return {
    channel: 'call',
    subject: `Voicemail from ${callerLabel} — needs a listen`,
    body: 'A voicemail was left, but it could not be transcribed. Listen to the recording attached '
      + 'to this record to find out what it was about.',
    campusOrgUnitId: ctx.campusOrgUnitId,
    arrivedAt,
    clockStartsAt: clockStart(arrivedAt),
    slaDueAt: slaDue(arrivedAt, 'normal'),
    sourceMessageId: voicemailSourceMessageId(v.callId),
    callerPhone: v.callerPhone,
    isSwitchboard: false,
    status: 'unfiled',
    urgency: 'normal',
    suggestedCategory: 'unclassified',
    suggestedUrgency: 'normal',
    suggestionReason: 'The recording could not be transcribed — needs a person to listen to it.',
    needsListen: true,
  };
}

// ---------------------------------------------------------------------------------------
// The REAL vendor shape (YOCC / way2voice.in), from their integration doc — 24-Sep-2026.
// Everything above this line was built against the brief's ASSUMED field list before a real
// vendor spec existed; this is what they actually send. Kept alongside rather than replacing
// it, since nothing else in the app depended on the old shape being removed.
//
// Genuinely different, not just renamed fields:
//   - Plain JSON (or query params — their doc says "Method – POST / GET"), never multipart;
//     the recording is a URL THEY host (`recordingurl`), never an uploaded file.
//   - No callId at all — there is nothing to de-duplicate on except the call itself
//     (caller + instant), the same fact core/missed-calls.ts already found true for the
//     Synapse feed and solved the same way.
//   - Three real outcomes, not one: Answered / Unanswered (rang the agent, nobody picked up)
//     / Un-opted (caller never chose a menu option at all). Their own sample payload sends
//     "Answered" WITH a recordingurl — so a recording is not proof a voicemail was left; it
//     may be a full call recording. See the route's own comment for why that distinction
//     matters (BACKLOG.md: full call recording is a separate, still-blocked decision from
//     voicemail capture).
// ---------------------------------------------------------------------------------------

export type CallStatus = 'Answered' | 'Unanswered' | 'Un-opted';
export type CallDirection = 'Inbound' | 'Outbound';

export interface RawCallWebhookPayload {
  CallerNo: unknown;
  CallDate: unknown;
  StartTime: unknown;
  EndTime: unknown;
  AgentNo: unknown;
  CallStatus: unknown;
  recordingurl: unknown;
  CallType: unknown;
}

export interface ValidatedCallWebhook {
  callerNo: string;
  callerPhone: string | null;
  startedAt: Date;
  durationSeconds: number;
  agentNo: string;
  callStatus: CallStatus;
  /** null when the vendor sent none — never assume every call carries one. */
  recordingUrl: string | null;
  callType: CallDirection;
}

const STATUS_MAP: Record<string, CallStatus> = {
  answered: 'Answered',
  unanswered: 'Unanswered',
  'un-opted': 'Un-opted',
  unopted: 'Un-opted',
  'un opted': 'Un-opted',
};

/**
 * Validate one call-webhook POST/GET in the vendor's own shape. A failure here is a 4xx — the
 * payload itself doesn't parse, and retrying the same values won't fix that.
 */
export function parseCallWebhookPayload(x: RawCallWebhookPayload): Parsed<ValidatedCallWebhook> {
  const callerNo = str(x.CallerNo);
  if (!callerNo) return { ok: false, reason: 'CallerNo is required.' };

  const callDate = str(x.CallDate);
  const startTime = str(x.StartTime);
  const endTime = str(x.EndTime);
  if (!callDate || !startTime || !endTime) {
    return { ok: false, reason: 'CallDate, StartTime and EndTime are all required.' };
  }

  const startedAt = parseIstDateTime(`${callDate} ${startTime}`);
  const endedAt = parseIstDateTime(`${callDate} ${endTime}`);
  if (!startedAt || !endedAt) {
    return {
      ok: false,
      reason: 'CallDate must be YYYY-MM-DD and StartTime/EndTime must be HH:MM:SS, e.g. 2025-02-26 / 10:06:12.',
    };
  }

  // EndTime a few seconds past midnight from a StartTime just before it is a real shape, not
  // an error — the vendor's own sample gives no date for each clock reading separately.
  let durationSeconds = Math.round((+endedAt - +startedAt) / 1000);
  if (durationSeconds < 0) durationSeconds += 86400;
  if (durationSeconds > MAX_CALL_DURATION_SECONDS) {
    return { ok: false, reason: `Call duration is over ${MAX_CALL_DURATION_SECONDS}s.` };
  }

  const statusRaw = str(x.CallStatus) ?? '';
  const callStatus = STATUS_MAP[statusRaw.toLowerCase()];
  if (!callStatus) {
    return {
      ok: false,
      reason: `CallStatus must be "Answered", "Unanswered" or "Un-opted"; got "${statusRaw}".`,
    };
  }

  const callTypeRaw = (str(x.CallType) ?? '').toLowerCase();
  const callType: CallDirection | null =
    callTypeRaw === 'inbound' ? 'Inbound' : callTypeRaw === 'outbound' ? 'Outbound' : null;
  if (!callType) {
    return { ok: false, reason: `CallType must be "Inbound" or "Outbound"; got "${str(x.CallType)}".` };
  }

  const agentNo = str(x.AgentNo) ?? '';
  const recordingUrl = str(x.recordingurl) || null;

  return {
    ok: true,
    value: {
      callerNo, callerPhone: normalisePhone(callerNo), startedAt, durationSeconds,
      agentNo, callStatus, recordingUrl, callType,
    },
  };
}

/**
 * De-duplication key when the vendor gives us no call id at all: the call itself (caller +
 * instant), exactly the same fact and the same fix core/missed-calls.ts's
 * `missedCallRowMessageId` already applied to the Synapse feed — a retried delivery of the
 * SAME call must resolve to the SAME key, not a fresh Request row.
 */
export function callWebhookSourceMessageId(callerNo: string, startedAt: Date): string {
  return `callwebhook-${callerNo}-${startedAt.toISOString()}`;
}

const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  Answered: 'was answered',
  Unanswered: 'rang the agent but was not answered',
  'Un-opted': 'never selected a menu option and disconnected',
};

export interface CallWebhookCapture {
  channel: 'call';
  subject: string;
  body: string;
  campusOrgUnitId: string;
  arrivedAt: Date;
  clockStartsAt: Date;
  slaDueAt: Date;
  sourceMessageId: string;
  callerPhone: string | null;
  isSwitchboard: false;
  status: 'unfiled';
  urgency: Urgency;
  suggestedCategory: string;
  suggestedUrgency: Urgency;
  suggestionReason: string;
  needsListen: boolean;
  /** True only when the vendor sent a recordingurl — the audio-fetch step is worth attempting. */
  hasRecording: boolean;
}

/**
 * Build the Request-creation fields for one call-webhook event. PURE, same split as
 * buildVoicemailCapture above: classification is deterministic and lives here; the actual
 * fetch of `recordingUrl` and any transcription are I/O and stay in app/api/voicemail/route.ts.
 */
export function buildCallWebhookCapture(
  v: ValidatedCallWebhook,
  ctx: { campusOrgUnitId: string; transcript: string | null; classifierName?: string },
): CallWebhookCapture {
  const arrivedAt = v.startedAt;
  const callerLabel = v.callerNo || 'a withheld number';
  const sourceMessageId = callWebhookSourceMessageId(v.callerNo, v.startedAt);

  if (ctx.transcript) {
    const sug = getClassifier(ctx.classifierName ?? 'rules').classify({
      subject: 'Voicemail', body: ctx.transcript, senderIsKnownFamily: false,
    });
    return {
      channel: 'call',
      subject: `Voicemail from ${callerLabel}`,
      body: ctx.transcript,
      campusOrgUnitId: ctx.campusOrgUnitId,
      arrivedAt,
      clockStartsAt: clockStart(arrivedAt),
      slaDueAt: slaDue(arrivedAt, sug.urgency),
      sourceMessageId,
      callerPhone: v.callerPhone,
      isSwitchboard: false,
      status: 'unfiled',
      urgency: sug.urgency,
      suggestedCategory: sug.category,
      suggestedUrgency: sug.urgency,
      suggestionReason: sug.reason,
      needsListen: false,
      hasRecording: true,
    };
  }

  const outcome = CALL_STATUS_LABEL[v.callStatus];
  const needsListen = Boolean(v.recordingUrl);
  return {
    channel: 'call',
    subject: needsListen
      ? `Voicemail from ${callerLabel} — needs a listen`
      : `Call from ${callerLabel} — ${outcome}`,
    body: needsListen
      ? 'A recording was captured, but it could not be transcribed. Listen to the recording '
        + 'attached to this record to find out what it was about.'
      : `The call ${outcome} (agent ${v.agentNo || 'unassigned'}). No recording was provided.`,
    campusOrgUnitId: ctx.campusOrgUnitId,
    arrivedAt,
    clockStartsAt: clockStart(arrivedAt),
    slaDueAt: slaDue(arrivedAt, 'normal'),
    sourceMessageId,
    callerPhone: v.callerPhone,
    isSwitchboard: false,
    status: 'unfiled',
    urgency: 'normal',
    suggestedCategory: 'unclassified',
    suggestedUrgency: 'normal',
    suggestionReason: needsListen
      ? 'The recording could not be transcribed — needs a person to listen to it.'
      : `The call ${outcome} — needs a person to read it.`,
    needsListen,
    hasRecording: Boolean(v.recordingUrl),
  };
}
