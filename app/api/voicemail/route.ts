// POST/GET /api/voicemail — the YOCC/way2voice.in call webhook (their integration doc,
// 24-Sep-2026, supersedes docs/IVR-VOICEMAIL-BRIEF.md's earlier ASSUMED field list — see
// core/voicemail.ts's "REAL vendor shape" section for what changed and why).
//
// Their own doc shows no auth header at all, so this route does NOT require one by default —
// VOICEMAIL_WEBHOOK_TOKEN, if set, is checked only when a token IS supplied and must then be
// right; a request with no token header at all is still accepted, matching their spec exactly.
// (Tighten this once the vendor confirms they can add a custom header, or gate by IP instead.)

import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { nextRequestNumber } from '@/lib/ref';
import { recomputeClustersDb } from '@/lib/clusters';
import { secretMatches } from '@/core/bridge';
import {
  buildCallWebhookCapture, callWebhookSourceMessageId, parseCallWebhookPayload, pickField,
  resolveVoicemailCampus, resolveVoicemailTeam, type RawCallWebhookPayload,
} from '@/core/voicemail';
import { getTranscriber } from '@/core/transcribe';
import { notifyVoicemailTeam } from '@/lib/notify-voicemail';
import { toStandardMp3 } from '@/lib/audio-convert';

/** `AGENT_CAMPUS_MAP="9225214602:fsk,9225214603:fwgs"` — which AgentNo maps to which campus
 *  CODE. Reuses VOICEMAIL_LINE_CAMPUS_MAP's env var name for continuity with existing config. */
function agentCampusMapFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const raw = env.VOICEMAIL_LINE_CAMPUS_MAP ?? '';
  const out = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const [num, code] = pair.split(':').map(s => s?.trim());
    if (num && code) out.set(num, code);
  }
  return out;
}

/** `AGENT_TEAM_MAP="9225214602:frontdesk@fsksurat.in,9225214603:transport@fsksurat.in"` — which
 *  AgentNo emails which team. Reuses VOICEMAIL_MENU_TEAM_MAP's env var name. */
function agentTeamMapFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const raw = env.VOICEMAIL_MENU_TEAM_MAP ?? '';
  const out = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const [agent, email] = pair.split(':').map(s => s?.trim());
    if (agent && email) out.set(agent.toLowerCase(), email);
  }
  return out;
}

/** Best-effort guess at the recording's content type from its URL, when the host doesn't say. */
function contentTypeFromUrl(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase().split(/[?#]/)[0];
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

const RECORDING_KEYS = ['recordingurl', 'recording_url', 'recording', 'recordingfile', 'recordurl', 'callrecording'];

function toRaw(o: Record<string, unknown>): RawCallWebhookPayload {
  return {
    CallerNo: pickField(o, 'CallerNo', 'caller_no', 'callernumber'),
    CallDate: pickField(o, 'CallDate', 'call_date'),
    StartTime: pickField(o, 'StartTime', 'start_time'),
    EndTime: pickField(o, 'EndTime', 'end_time'),
    AgentNo: pickField(o, 'AgentNo', 'agent_no', 'agentnumber'),
    CallStatus: pickField(o, 'CallStatus', 'call_status', 'status'),
    recordingurl: pickField(o, ...RECORDING_KEYS),
    CallType: pickField(o, 'CallType', 'call_type'),
  };
}

async function handle(req: NextRequest, raw: RawCallWebhookPayload, receivedKeys: string[]) {
  const secret = process.env.VOICEMAIL_WEBHOOK_TOKEN;
  const givenToken = req.headers.get('x-voicemail-token');
  if (secret && givenToken && !secretMatches(secret, givenToken)) {
    return NextResponse.json({ reason: 'Bad voicemail token.' }, { status: 401 });
  }

  const parsed = parseCallWebhookPayload(raw);
  if (!parsed.ok) return NextResponse.json({ reason: parsed.reason }, { status: 400 });
  const v = parsed.value;

  // Idempotent retry: the same call (caller + instant) resolves to the same reference — the
  // vendor's doc gives us no call id to key on, so the call itself IS the key.
  const sourceMessageId = callWebhookSourceMessageId(v.callerNo, v.startedAt);
  const existing = await db.request.findUnique({ where: { sourceMessageId }, select: { ref: true } });
  if (existing) return NextResponse.json({ ref: existing.ref }, { status: 200 });

  if (v.callerPhone) {
    const blocked = await db.blockedCaller.findUnique({ where: { phoneKey: v.callerPhone } });
    if (blocked) return NextResponse.json({ skipped: 'blocked-caller' }, { status: 200 });
  }

  const campuses = await db.orgUnit.findMany({ where: { type: 'CAMPUS' }, select: { id: true, code: true } });
  if (campuses.length === 0) {
    return NextResponse.json({ reason: 'No campus is seeded yet.' }, { status: 500 });
  }
  const agentToCampus = new Map<string, string>();
  for (const [agent, code] of agentCampusMapFromEnv(process.env)) {
    const campus = campuses.find(c => c.code === code);
    if (campus) agentToCampus.set(agent, campus.id);
  }
  const fallbackCampus = campuses.find(c => c.code === 'fsk')?.id ?? campuses[0].id;
  const { campus: campusOrgUnitId } = resolveVoicemailCampus(v.agentNo, agentToCampus, fallbackCampus);

  const familyMatch = v.callerPhone
    ? await db.familyPhone.findFirst({ where: { phoneKey: v.callerPhone }, select: { familyId: true } })
    : null;

  // Fetch the recording ourselves when the vendor gave us a URL — their side hosts it, but we
  // hold the audio (brief's own retention ask). Never fatal: if the fetch fails, the record is
  // still created, marked needs-a-listen, with the URL itself kept on the record's audio row.
  let audioBuffer: Buffer<ArrayBuffer> | null = null;
  let audioContentType: string | null = null;
  let recordingNote = 'Recording: none sent by the vendor for this call.';
  if (v.recordingUrl) {
    try {
      const res = await fetch(v.recordingUrl, { signal: AbortSignal.timeout(15_000) });
      const type = res.headers.get('content-type') || contentTypeFromUrl(v.recordingUrl);
      if (!res.ok) {
        recordingNote = `Recording link ${v.recordingUrl} could not be downloaded (HTTP ${res.status}).`;
      } else if (/text\/html/i.test(type)) {
        // A login or error page answered with 200 — storing it as "audio" would give a silent player.
        recordingNote = `Recording link ${v.recordingUrl} returned a web page, not audio — open it directly.`;
      } else {
        const raw = Buffer.from(new Uint8Array(await res.arrayBuffer()));
        const kb = Math.round(raw.length / 1024);
        const converted = await toStandardMp3(raw);
        if (converted.ok) {
          audioBuffer = converted.audio;
          audioContentType = 'audio/mpeg';
          recordingNote = `Recording downloaded from ${v.recordingUrl} — ${kb} KB ${type}, converted to standard MP3.`;
        } else {
          audioBuffer = raw;
          audioContentType = type;
          recordingNote = `Recording downloaded from ${v.recordingUrl} — ${kb} KB ${type}; conversion failed (${converted.reason}), kept as received.`;
        }
      }
    } catch (err) {
      audioBuffer = null;
      // undici's "fetch failed" hides the real reason (refused, timeout, DNS, TLS) in `cause`.
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      const why = [err instanceof Error ? err.message : String(err), cause?.code, cause?.message]
        .filter(Boolean).join(' — ');
      recordingNote = `Recording link ${v.recordingUrl} could not be downloaded (${why}).`;
      console.warn(`[voicemail] recording download failed: ${why}`);
    }
  }

  let transcript: string | null = null;
  if (audioBuffer) {
    try {
      const result = await getTranscriber().transcribe({
        audio: audioBuffer, contentType: audioContentType ?? 'application/octet-stream',
        durationSeconds: v.durationSeconds,
      });
      transcript = result?.text ?? null;
    } catch {
      transcript = null;
    }
  }

  const capture = buildCallWebhookCapture(v, { campusOrgUnitId, transcript, audioAttached: Boolean(audioBuffer) });
  const ref = `FD-${String(await nextRequestNumber()).padStart(4, '0')}`;
  const now = new Date();
  const requestId = randomUUID();

  await db.request.create({
    data: {
      id: requestId, ref,
      channel: capture.channel,
      campusOrgUnitId: capture.campusOrgUnitId,
      familyId: familyMatch?.familyId ?? null,
      subject: capture.subject,
      body: capture.body,
      originalRecipients: [],
      arrivedAt: capture.arrivedAt,
      clockStartsAt: capture.clockStartsAt,
      slaDueAt: capture.slaDueAt,
      category: null,
      urgency: capture.urgency,
      status: capture.status,
      suggestedCategory: capture.suggestedCategory,
      suggestedUrgency: capture.suggestedUrgency,
      suggestionReason: capture.suggestionReason,
      isSwitchboard: capture.isSwitchboard,
      isAutomated: false,
      sourceMessageId: capture.sourceMessageId,
      messages: {
        create: [{ id: randomUUID(), direction: 'in', senderLabel: 'IVR / call webhook', at: capture.arrivedAt, body: capture.body }],
      },
      activities: {
        create: [
          { id: randomUUID(), at: now, kind: 'note',
            detail: `Captured from the call webhook (${v.callStatus}, caller ${v.callerNo}) — nothing auto-enters the working queue; the desk files this like any capture.` },
          { id: randomUUID(), at: now, kind: 'classified',
            detail: `Suggested "${capture.suggestedCategory}" — ${capture.suggestionReason}` },
          // Field NAMES only, never values — enough to see if the vendor renamed a field, without
          // copying a caller's details into the trail twice.
          { id: randomUUID(), at: now, kind: 'note',
            detail: `${recordingNote} Fields received: ${receivedKeys.join(', ') || '(none)'}.` },
        ],
      },
      ...(audioBuffer ? {
        voicemailAudio: {
          create: {
            id: randomUUID(),
            dialledNumber: v.agentNo,
            callerNumber: v.callerNo,
            ivrMenu: null,
            contentType: audioContentType ?? 'application/octet-stream',
            sizeBytes: audioBuffer.length,
            durationSeconds: v.durationSeconds,
            audio: audioBuffer,
          },
        },
      } : {}),
    },
  });

  const team = resolveVoicemailTeam(
    v.agentNo || null, agentTeamMapFromEnv(process.env), process.env.VOICEMAIL_FALLBACK_TEAM_EMAIL ?? '',
  );
  let notifyDetail = 'No team email configured — set VOICEMAIL_MENU_TEAM_MAP or VOICEMAIL_FALLBACK_TEAM_EMAIL.';
  if (team.email) {
    const appUrl = process.env.APP_BASE_URL;
    const subject = capture.needsListen
      ? `Voicemail needs a listen — ${ref}`
      : `${v.callStatus} call (${capture.suggestedCategory}) — ${ref}`;
    const body = [
      capture.body,
      '',
      `Reference: ${ref}`,
      appUrl ? `Open: ${appUrl}/r/${ref}` : `Open the Front Desk app and find ${ref} in the queue.`,
    ].join('\n');
    const result = await notifyVoicemailTeam({ to: team.email, subject, body, boundarySeed: capture.sourceMessageId });
    notifyDetail = `Routed by ${team.how} to ${team.email}. ` + (result.sent ? 'Emailed.' : `Not emailed — ${result.detail}`);
  }
  await db.activity.create({
    data: { id: randomUUID(), requestId, at: new Date(), kind: 'note', detail: notifyDetail },
  });

  await recomputeClustersDb();
  revalidatePath('/');
  revalidatePath('/patterns');
  revalidatePath('/oversight');

  return NextResponse.json({ ref }, { status: 200 });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reason: 'Body must be JSON.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ reason: 'Body must be a JSON object.' }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  console.log(`[voicemail] POST fields: ${Object.keys(o).join(', ')}`);
  return handle(req, toRaw(o), Object.keys(o));
}

export async function GET(req: NextRequest) {
  const o = Object.fromEntries(req.nextUrl.searchParams.entries());
  console.log(`[voicemail] GET fields: ${Object.keys(o).join(', ')}`);
  return handle(req, toRaw(o), Object.keys(o));
}
