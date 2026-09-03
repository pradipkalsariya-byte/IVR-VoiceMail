// POST /api/voicemail — the IVR "press 2 to leave a message" endpoint (BACKLOG's ready item;
// see docs/IVR-VOICEMAIL-BRIEF.md, "the technical half", for the field list and the vendor
// conversation this was specified against).
//
// Dormant unless VOICEMAIL_WEBHOOK_TOKEN is set: without it the route answers 404, same shape
// as app/api/bridge/requests/route.ts — a deploy with no PBX wired carries no new surface at
// all. middleware.ts excludes this path from the shared testing-phase passcode for the same
// reason it excludes /api/health: the vendor has no way to supply that passcode, and this
// route carries its own auth (the X-Voicemail-Token shared secret) instead.

import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { nextRequestNumber } from '@/lib/ref';
import { recomputeClustersDb } from '@/lib/clusters';
import { secretMatches } from '@/core/bridge';
import {
  buildVoicemailCapture, parseVoicemailPayload, resolveVoicemailTeam, voicemailSourceMessageId,
} from '@/core/voicemail';
import { getTranscriber } from '@/core/transcribe';
import { notifyVoicemailTeam } from '@/lib/notify-voicemail';

/**
 * `VOICEMAIL_LINE_CAMPUS_MAP="919900001234:fsk,919900005678:fwgs"` — which dialled number maps
 * to which campus CODE (matched against OrgUnit.code, same vocabulary the seed and the other
 * ingestion paths already use). Parsed fresh per request: this is config, not hot-path work,
 * and a single POST is nowhere near the volume where that would matter.
 */
function lineCampusMapFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const raw = env.VOICEMAIL_LINE_CAMPUS_MAP ?? '';
  const out = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const [num, code] = pair.split(':').map(s => s?.trim());
    if (num && code) out.set(num, code);
  }
  return out;
}

/**
 * `VOICEMAIL_MENU_TEAM_MAP="Front Desk:frontdesk@fsksurat.in,Transport:transport@fsksurat.in"`
 * — which IVR menu selection routes to which team's mailbox. Keys are lower-cased here so
 * core/voicemail.ts's resolveVoicemailTeam can match case-insensitively against whatever
 * casing the vendor actually sends per call.
 */
function menuTeamMapFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const raw = env.VOICEMAIL_MENU_TEAM_MAP ?? '';
  const out = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const [menu, email] = pair.split(':').map(s => s?.trim());
    if (menu && email) out.set(menu.toLowerCase(), email);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const secret = process.env.VOICEMAIL_WEBHOOK_TOKEN;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!secretMatches(secret, req.headers.get('x-voicemail-token'))) {
    return NextResponse.json({ reason: 'Bad voicemail token.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ reason: 'Body must be multipart/form-data.' }, { status: 400 });
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ reason: 'audio is required.' }, { status: 400 });
  }

  const parsed = parseVoicemailPayload({
    callId: form.get('callId'),
    callerNumber: form.get('callerNumber'),
    dialledNumber: form.get('dialledNumber'),
    startedAt: form.get('startedAt'),
    durationSeconds: form.get('durationSeconds'),
    audioContentType: audio.type || 'application/octet-stream',
    audioSizeBytes: audio.size,
    menu: form.get('menu'),
  });
  if (!parsed.ok) return NextResponse.json({ reason: parsed.reason }, { status: 400 });
  const v = parsed.value;

  // Idempotent retry (brief step 1): a callId already on file means this is a redelivery, not a
  // second call. Reply 200 with the SAME reference — never re-transcribe, never create a sibling.
  const sourceMessageId = voicemailSourceMessageId(v.callId);
  const existing = await db.request.findUnique({
    where: { sourceMessageId }, select: { ref: true },
  });
  if (existing) return NextResponse.json({ ref: existing.ref }, { status: 200 });

  // Blocked callers never become slips here either (same policy core/ingest.ts's missed-call
  // explosion already applies) — acked with 200 so the PBX does not retry, but nothing is filed.
  if (v.callerPhone) {
    const blocked = await db.blockedCaller.findUnique({ where: { phoneKey: v.callerPhone } });
    if (blocked) return NextResponse.json({ skipped: 'blocked-caller' }, { status: 200 });
  }

  const campuses = await db.orgUnit.findMany({ where: { type: 'CAMPUS' }, select: { id: true, code: true } });
  if (campuses.length === 0) {
    return NextResponse.json({ reason: 'No campus is seeded yet.' }, { status: 500 });
  }
  // A configured code that names no real campus (typo, stale config after a campus is
  // renamed) must fall through to fallbackCampus below, never sneak the raw code string in as
  // if it were an org-unit id — that would fail the Request→OrgUnit foreign key at create time
  // instead of degrading gracefully to "unmapped line".
  const lineToCampus = new Map<string, string>();
  for (const [num, code] of lineCampusMapFromEnv(process.env)) {
    const campus = campuses.find(c => c.code === code);
    if (campus) lineToCampus.set(num, campus.id);
  }
  const fallbackCampus = campuses.find(c => c.code === 'fsk')?.id ?? campuses[0].id;
  const campusHit = lineToCampus.get(v.dialledNumber.trim());
  const campusOrgUnitId = campusHit ?? fallbackCampus;

  const familyMatch = v.callerPhone
    ? await db.familyPhone.findFirst({ where: { phoneKey: v.callerPhone }, select: { familyId: true } })
    : null;

  const audioBuffer = Buffer.from(await audio.arrayBuffer());

  // Transcription failure must never lose the call (brief step 2) — whatever happens here,
  // execution falls through to create the record either way.
  let transcript: string | null = null;
  try {
    const result = await getTranscriber().transcribe({
      audio: audioBuffer, contentType: v.audioContentType, durationSeconds: v.durationSeconds,
    });
    transcript = result?.text ?? null;
  } catch {
    transcript = null;
  }

  const capture = buildVoicemailCapture(v, { campusOrgUnitId, transcript });
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
        create: [{ id: randomUUID(), direction: 'in', senderLabel: 'IVR voicemail', at: capture.arrivedAt, body: capture.body }],
      },
      activities: {
        create: [
          { id: randomUUID(), at: now, kind: 'note',
            detail: `Captured from an IVR voicemail (call ${v.callId}) — nothing auto-enters the working queue; the desk files this like any capture.` },
          { id: randomUUID(), at: now, kind: 'classified',
            detail: `Suggested "${capture.suggestedCategory}" — ${capture.suggestionReason}` },
        ],
      },
      voicemailAudio: {
        create: {
          id: randomUUID(),
          dialledNumber: v.dialledNumber,
          callerNumber: v.callerNumber,
          ivrMenu: v.menu,
          contentType: v.audioContentType,
          sizeBytes: v.audioSizeBytes,
          durationSeconds: v.durationSeconds,
          audio: audioBuffer,
        },
      },
    },
  });

  // Route to the team the caller's IVR menu selection maps to (VK, 03-Sep-2026: email the
  // respective team, not just file the record). Fire-and-forget by the same contract as
  // lib/bridge-push.ts: the Request above is already the record of truth, so a Gmail outage or
  // an unconfigured send-as alias must never fail this webhook — only what the caller sees.
  const team = resolveVoicemailTeam(
    v.menu, menuTeamMapFromEnv(process.env), process.env.VOICEMAIL_FALLBACK_TEAM_EMAIL ?? '',
  );
  let notifyDetail = 'No team email configured — set VOICEMAIL_MENU_TEAM_MAP or VOICEMAIL_FALLBACK_TEAM_EMAIL.';
  if (team.email) {
    const appUrl = process.env.APP_BASE_URL;
    const subject = capture.needsListen
      ? `Voicemail needs a listen — ${ref}`
      : `Voicemail (${capture.suggestedCategory}) — ${ref}`;
    const body = [
      capture.body, // already the transcript, or the honest "could not be transcribed" wording
      '',
      `Reference: ${ref}`,
      appUrl ? `Open: ${appUrl}/r/${ref}` : `Open the Front Desk app and find ${ref} in the queue.`,
    ].join('\n');
    const result = await notifyVoicemailTeam({
      to: team.email, subject, body, boundarySeed: capture.sourceMessageId,
    });
    notifyDetail = `Routed by ${team.how} to ${team.email}. `
      + (result.sent ? 'Emailed.' : `Not emailed — ${result.detail}`);
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
