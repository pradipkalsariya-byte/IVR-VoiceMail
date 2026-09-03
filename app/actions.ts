'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { nextRequestNumber } from '@/lib/ref';
import { ACTING_COOKIE, currentActor } from '@/lib/session';
import { personaSwitchEnabled } from '@/lib/auth/mode';
import { chooseRails, railsLabel, canSendEmailReply } from '@/core/app-rail';
import { emailEnvelope, pilotConfigFromEnv } from '@/core/pilot';
import { GmailMailSender, gmailConfigFromEnv } from '@/lib/ingest/gmail';
import { getClassifier, looksLikeSwitchboard } from '@/core/classify';
import { assignableOwner, can, derivedSeriousness, needsSecondLook, secondLook, type Action } from '@/core/permissions';
import { autoAssign } from '@/lib/assignment';
import { closureVerdict, SATISFACTION_ABSENT_REASONS } from '@/core/closure';
import { canActOnStatus } from '@/core/lifecycle';
import { ackDueFrom, clockStart, DEFAULT_DESK, slaDue } from '@/core/sla';
import { normalisePhone } from '@/core/phone';
import { recomputeClustersDb } from '@/lib/clusters';
import { pushToParentApp } from '@/lib/bridge-push';
import { runRecordedIngest } from '@/lib/ingest/recorded';
import type { Urgency } from '@/core/taxonomy';

const bump = () => {
  revalidatePath('/');
  revalidatePath('/patterns');
  revalidatePath('/oversight');
};

export async function setActor(id: string) {
  // The pilot's persona layer, never an identity bypass (2026-08-24, the sign-in port): in
  // google mode this exists only while ENABLE_PERSONA_SWITCH=true, and only for a caller who
  // is already signed in — currentActor() throws for anyone who is not.
  if (!personaSwitchEnabled()) throw new Error('The persona switcher is switched off.');
  await currentActor();
  const jar = await cookies();
  jar.set(ACTING_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  bump();
}

/**
 * Everything below binds the actor to the SERVER session, never to a form field — and since
 * 2026-08-07 checks CAPABILITY per action (QM-D9/D26), not the old isLeadership boolean.
 * can() covers scope (an out-of-scope id is refused even if the client somehow names it),
 * the named safeguarding grant (R3-4) and the vendor-owner rule (R3-23) in one seam, and
 * every refusal carries its reason to the caller.
 */
async function guard(requestId: string, action: Action) {
  const actor = await currentActor();
  const req = await db.request.findUnique({ where: { id: requestId } });
  if (!req) throw new Error('Request not found.');
  const decision = can(actor, action, {
    campusOrgUnitId: req.campusOrgUnitId,
    isSafeguarding: req.isSafeguarding,
    isOwnedByActor: req.ownerId === actor.id,
    isAboutActor: req.aboutStaffIds.includes(actor.id),
  });
  if (!decision.allowed) throw new Error(decision.reason);
  return { actor, req };
}

async function log(requestId: string, actorId: string | null, kind: string, detail: string) {
  await db.activity.create({
    data: { id: randomUUID(), requestId, actorId, at: new Date(), kind, detail },
  });
}

export async function fileRequest(requestId: string, category: string, urgency: Urgency) {
  const { actor, req } = await guard(requestId, 'file');
  const filedAt = new Date();
  const due = slaDue(req.arrivedAt, urgency);
  const changed = category !== req.suggestedCategory || urgency !== req.suggestedUrgency;

  // QM-D10: seriousness is recorded at filing. 'high' marks the request pending-second-look —
  // a DERIVED state (seriousness + no approval yet, QM-D15's no-stored-flag shape), and one
  // that never gates the response: replies and resolution proceed while approval is pending.
  const seriousness = derivedSeriousness({ urgency, isSafeguarding: req.isSafeguarding });

  await db.request.update({
    where: { id: requestId },
    data: {
      category, urgency, status: 'open', slaDueAt: due, clockStartsAt: clockStart(req.arrivedAt),
      seriousness,
      // The TWO clocks anchor differently, on purpose. The response clock (slaDueAt) runs from
      // ARRIVAL — slow triage must not buy the desk more reply time. The acknowledgement clock
      // runs from FILING, this very moment (QM-D12: filing, not capture) — an unfiled item is
      // not yet anyone's to acknowledge. Set once: re-filing to fix a category must not
      // restart a clock that measures the family's wait for a first human look.
      ackDueAt: req.ackDueAt ?? ackDueFrom(filedAt, DEFAULT_DESK, urgency),
    },
  });
  await log(requestId, actor.id, 'filed',
    changed
      ? `Filed as "${category}" / ${urgency} — overriding the suggestion "${req.suggestedCategory}" / ${req.suggestedUrgency}.`
      : `Filed as "${category}" / ${urgency}, accepting the suggestion.`);
  if (needsSecondLook(seriousness)) {
    await log(requestId, actor.id, 'note',
      `Seriousness is ${seriousness} — awaiting a second look (QM-D10). The response is not gated on it.`);
  }

  // Feedback #18 — route it now that there is a category to route ON. Filing, not arrival:
  // assigning before a human has read the thing would put someone's name against a request
  // nobody has looked at. Never overrides an owner a person already chose.
  await autoAssign(requestId, filedAt);

  bump();
}

export async function markNotARequest(requestId: string) {
  const { actor } = await guard(requestId, 'file');
  await db.request.update({
    where: { id: requestId },
    // Both clocks go: nobody owes a robot an acknowledgement any more than a reply, and
    // core/clocks.ts reads a parked status as `na` regardless.
    data: { status: 'not_a_request', category: 'not-a-request', slaDueAt: null, ackDueAt: null },
  });
  await log(requestId, actor.id, 'filed', 'Marked as not a parent request — kept on record, out of the working queue.');
  bump();
}

/**
 * Stop a number's missed calls becoming callback slips, and retire the ones it already made.
 *
 * The live Switchboard on 27-Aug-2026 held 437 slips from 147 callers, of which ONE number had
 * made 174 -- about 11.6 a day, every day. It and the second-busiest share a landline prefix, so
 * they read as the school's own extensions rather than anyone trying to reach the desk.
 *
 * BLOCKING NEVER DELETES. The calls stay on the record with their trail intact; they simply
 * leave the callback list. A desk that finds its own history disappearing stops trusting the
 * tool, and "we blocked this number in August" is precisely the fact somebody needs in November.
 *
 * Rides the 'file' grant -- the same one that sets something aside and takes it back. Blocking a
 * caller is a bigger act than either, but it is the same KIND of act, and inventing a new
 * permission tier for it would mean nobody on the desk could actually use it.
 */
export async function blockCaller(phone: string, reason: string) {
  const actor = await currentActor();
  if (!actor) throw new Error('Sign in first.');
  if (!can(actor, 'file')) throw new Error('You do not have the grant to set work aside.');

  const phoneKey = normalisePhone(phone);
  if (!phoneKey) throw new Error('That does not look like a phone number.');
  const why = reason.trim();
  if (!why) throw new Error('Say why, in a few words — somebody will read this later.');

  const already = await db.blockedCaller.findUnique({ where: { phoneKey } });
  if (!already) {
    await db.blockedCaller.create({
      data: { id: randomUUID(), phoneKey, reason: why, blockedBy: actor.id },
    });
  }

  // Retire what it has already made. Only slips nobody has picked up: if a person has filed or
  // owned one, that is their work and a block is not a licence to undo it.
  const slips = await db.request.findMany({
    where: { isSwitchboard: true, status: 'unfiled', ownerId: null },
    select: { id: true, subject: true },
  });
  // A regex LITERAL, not built from strings: \d in a single-quoted JS string is just "d",
  // so the assembled version matched the literal text "dddddddddd" and never fired.
  const TRAILING = /(\d{10})\s*$/;
  let retired = 0;
  for (const slip of slips) {
    const m = (slip.subject ?? '').match(TRAILING);
    if (!m || normalisePhone(m[1]) !== phoneKey) continue;
    await db.request.update({
      where: { id: slip.id },
      data: { status: 'not_a_request', category: 'not-a-request', slaDueAt: null, ackDueAt: null },
    });
    await log(slip.id, actor.id, 'filed', `Caller blocked — ${why}. Kept on record, out of the callback list.`);
    retired++;
  }

  bump();
  revalidatePath('/switchboard');
  return { retired, alreadyBlocked: Boolean(already) };
}

/**
 * Register #5's second half: "front desk decides."
 *
 * The app sets internal mail aside when it can see no request in it. This is how a person
 * disagrees — one click, and it is back in the queue as UNFILED so it goes through normal
 * triage rather than being force-filed into a category nobody chose.
 *
 * Rides the 'file' grant, the same one markNotARequest() uses. Whoever may set something aside
 * may take it back; a right to hide that is not matched by a right to unhide would be the wrong
 * shape entirely.
 *
 * The response clock is restarted from ARRIVAL, not from now. The family (or the colleague) has
 * been waiting since the message landed, and anchoring on the moment somebody noticed would
 * quietly forgive exactly the delay this button exists to correct — the same reasoning as
 * lib/rescue-safeguarding.ts, learned the same day.
 */
export async function bringIntoQueue(requestId: string) {
  const { actor, req } = await guard(requestId, 'file');
  await db.request.update({
    where: { id: requestId },
    data: {
      status: 'unfiled',
      category: null,
      isVendorNoise: false,
      slaDueAt: slaDue(req.arrivedAt, (req.urgency as Urgency) ?? 'normal'),
    },
  });
  await log(
    requestId, actor.id, 'filed',
    'Brought back into the working queue — the desk decided this does need doing.',
  );
  bump();
  revalidatePath(`/r/${req.ref}`);
}

/**
 * A human has LOOKED at this — the event the acknowledgement clock (QM-D12) measures. Any
 * staff member with scope may acknowledge; it is deliberately NOT owner-gated, because the
 * family's wait ends when SOMEONE looks, not when the eventual owner does. In the capability
 * world (QM-D9/D26) it rides 'file' — the desk's basic handling grant, the same one quickLog
 * stamps acknowledgedAt under — so anyone who can file can record a first look; guard()
 * layers scope and the named safeguarding grant (R3-4) on top, which is all the gating this
 * needs.
 */
export async function acknowledge(requestId: string) {
  const { actor, req } = await guard(requestId, 'file');
  // Set once. The clock measures the FIRST human look; a second click must not move the
  // stamp the metric is read against (same rule as firstReplyAt in reply()).
  if (req.acknowledgedAt) return;

  await db.request.update({ where: { id: requestId }, data: { acknowledgedAt: new Date() } });
  await log(requestId, actor.id, 'acknowledged',
    `${actor.name} has seen this — the family is no longer waiting for a first look.`);
  bump();
  revalidatePath(`/r/${req.ref}`);
}

export async function assign(requestId: string, ownerId: string) {
  const { actor, req } = await guard(requestId, 'assign');
  // QM-D32: a complaint about a person is never their work item. An identity rule like the
  // two-person rule, so it sits beside can() rather than inside it — checked on the TARGET
  // of the assignment, which can() never sees. Clearing the owner ('') is always allowed.
  // The candidate's scope and the request's campus BOTH come from the database — never from
  // the submitted form. That is the estate rule written after route-planning's addStudent took
  // a campus id as a trusted field: a caller who can post a form can post any campus.
  const owner = ownerId ? await db.staff.findUnique({ where: { id: ownerId } }) : null;
  if (ownerId) {
    if (!owner) throw new Error('That person is no longer in the staff directory.');
    const assignable = assignableOwner(
      req.aboutStaffIds, ownerId, owner.scopeOrgUnitId, req.campusOrgUnitId,
    );
    if (!assignable.allowed) throw new Error(assignable.reason);
  }
  // ownerSetAt moves WITH the owner (feedback #20). Cleared alongside, so an item returned to
  // the pool does not carry the previous owner's clock into the next person's hands.
  await db.request.update({
    where: { id: requestId },
    data: { ownerId: ownerId || null, ownerSetAt: ownerId ? new Date() : null },
  });
  await log(requestId, actor.id, 'assigned',
    owner ? `Owner set to ${owner.name} (${owner.roleLabel}).` : 'Owner cleared.');
  bump();
}

/**
 * Name (or un-name) a staff member this complaint is ABOUT. Naming them excludes them from the
 * record's audience entirely (QM-D33): guard()'s isAboutActor and the queue's row suppression
 * both read the list this writes. Rides 'file' — marking is a triage judgment, the same class
 * of act as filing, and needs no more than the desk's basic handling grant.
 */
export async function markAboutStaff(requestId: string, staffId: string, remove?: boolean) {
  const { actor, req } = await guard(requestId, 'file');
  const target = await db.staff.findUnique({ where: { id: staffId } });
  if (!target) throw new Error('That person is not in the staff directory.');

  // Self-marking is refused: you cannot place YOURSELF outside a record's audience — the mark
  // is a disclosure decision about the record, and made on yourself it is just a lockout
  // (accidental or otherwise) with nobody left who noticed it happen. A colleague makes it.
  if (!remove && staffId === actor.id) {
    throw new Error(
      'You cannot mark a complaint as being about yourself — that would lock you out of the ' +
        'record, and placing someone outside its audience is a decision a colleague makes, ' +
        'not the person concerned. Ask a colleague to mark it.',
    );
  }

  const next = remove
    ? req.aboutStaffIds.filter(id => id !== staffId)
    : req.aboutStaffIds.includes(staffId)
      ? req.aboutStaffIds
      : [...req.aboutStaffIds, staffId];

  // If the current owner is now someone the complaint is about, the ownership is exactly what
  // QM-D32 forbids — clear it, and say so in the trail rather than fixing it silently.
  const ownerExcluded = !remove && req.ownerId != null && next.includes(req.ownerId);

  await db.request.update({
    where: { id: requestId },
    data: { aboutStaffIds: next, ...(ownerExcluded ? { ownerId: null } : {}) },
  });
  await log(requestId, actor.id, 'note',
    remove
      ? `No longer marked as concerning ${target.name}.`
      : `Marked as concerning ${target.name} — excluded from this record's audience (QM-D33).`);
  if (ownerExcluded) {
    await log(requestId, actor.id, 'note',
      `Owner cleared: a complaint about ${target.name} cannot be their work item (QM-D32). ` +
        'Assign someone else.');
  }
  bump();
  revalidatePath(`/r/${req.ref}`);
}

/**
 * Record the named-person conversation. This leg IS how the substance reaches the person the
 * complaint is about (QM-D33) — the record itself never does. Activity kind 'conveyed'
 * (rendered in the trail as "Conversation held") extends the Activity.kind list; the schema
 * comment enumerates the rest. Rides 'resolve' — holding the conversation is part of handling
 * the complaint, the same grant that replies and closes.
 */
export async function recordConveyed(requestId: string, staffId: string, note: string) {
  const { actor, req } = await guard(requestId, 'resolve');
  if (!req.aboutStaffIds.includes(staffId)) {
    throw new Error(
      'A conveyed-conversation leg is only for someone this complaint is about — this person ' +
        'is not named on it. If the complaint concerns them, mark that first.',
    );
  }
  const target = await db.staff.findUnique({ where: { id: staffId } });
  if (!target) throw new Error('That person is not in the staff directory.');
  const text = note.trim();
  if (!text) {
    throw new Error(
      'Say what was conveyed — this leg is the only route the substance takes to the named ' +
        'person, so an empty note defeats its purpose.',
    );
  }
  await log(requestId, actor.id, 'conveyed', `Spoke with ${target.name} — ${text}`);
  bump();
  revalidatePath(`/r/${req.ref}`);
}

export async function reply(requestId: string, body: string) {
  // Replying rides the 'resolve' capability — the coarse list has one grant for "handle the
  // request", not one per verb. Note there is deliberately NO triage-gate check here (QM-D10).
  const { actor, req } = await guard(requestId, 'resolve');
  // WHO may act is guard()'s question; WHEN is the lifecycle's: an unfiled record takes no
  // reply — filing is the acknowledgement act (QM-D12), and the 2026-08-09 review found this
  // callable straight past the queue's "only what you file enters the working queue".
  const lifecycle = canActOnStatus('reply', req.status);
  if (!lifecycle.allowed) throw new Error(lifecycle.reason);
  const text = body.trim();
  if (!text) throw new Error('A reply needs some text.');

  // QM-D35: the reply is authored ONCE — content plus a delivery intent — and the ENGINE
  // chooses the rail per recipient, never the author. In the prototype a linked family "has
  // a login" by construction (this demo IS the app), and hasEmail comes off the family
  // record; production asks the identity plane instead. The choice lands on the message's
  // dispatch field so there is one outbound voice and one history whichever rail carried it
  // (QM-D8 by construction) — and an empty rail set is stored honestly, not hidden: an
  // unreachable recipient is a fact the trail should show.
  const family = req.familyId
    ? await db.family.findUnique({ where: { id: req.familyId } })
    : null;
  const rails = chooseRails({
    hasAppLogin: family != null,
    hasEmail: Boolean(family?.emailKey),
  });

  // Real sending, wired for the first time (2026-08-12) — every prior build recorded this
  // internally and told the family nothing, no matter what the record page's own copy claimed.
  // That combination silently sends nothing when canSendEmailReply is false — not a new gap,
  // just one this change does not additionally claim to close (see its own doc comment). When
  // it IS true, sending is not optional: isReady()'s refusal throws rather than recording a
  // reply that never left the building.
  if (rails.includes('email') && canSendEmailReply(req, family?.emailKey)) {
    const sender = new GmailMailSender({ ...gmailConfigFromEnv(), sendAsAlias: process.env.GMAIL_SEND_AS });
    const gate = await sender.isReady();
    if (!gate.ready) throw new Error(gate.reason);
    const envelope = emailEnvelope(family!.emailKey, req.subject, text, pilotConfigFromEnv());
    await sender.reply({
      threadId: req.sourceThreadId!,
      inReplyToMessageId: req.sourceMessageId!,
      to: envelope.to,
      cc: envelope.cc,
      subject: envelope.subject,
      body: envelope.body,
      fromAlias: process.env.GMAIL_SEND_AS!,
    });
  }

  const at = new Date();
  await db.requestMessage.create({
    data: {
      id: randomUUID(), requestId, direction: 'out',
      senderLabel: actor.name, at, body: text, dispatch: rails,
    },
  });
  await db.request.update({
    where: { id: requestId },
    // firstReplyAt is set once and never moved — it is what the SLA is measured against.
    data: { firstReplyAt: req.firstReplyAt ?? at, status: 'waiting' },
  });
  await log(requestId, actor.id, 'replied',
    `Replied to the family (${text.length} characters) — ${railsLabel(rails)}.`);
  // App-channel requests may have a second face in the Nucleus parent app — mirror the reply
  // there (fire-and-forget; content only, never the actor's name).
  if (req.channel === 'app') await pushToParentApp(req.ref, { kind: 'message', body: text });
  bump();
  revalidatePath(`/r/${req.ref}`);
}

export async function resolve(
  requestId: string,
  note: string,
  closure?: { satisfaction?: number | null; absentReason?: string | null },
) {
  // QM-D10: an outstanding second look NEVER blocks this — a serious complaint is answered
  // and closed while the second pair of eyes is still pending, so no pendingSecondLook check.
  const { actor, req } = await guard(requestId, 'resolve');
  const lifecycle = canActOnStatus('resolve', req.status);
  if (!lifecycle.allowed) throw new Error(lifecycle.reason);

  // QM-D18: closure needs the family's rating OR a coded reason for its absence. The gate is
  // pure (core/closure.ts) and the deny reason is shown to the person closing, not swallowed.
  const verdict = closureVerdict({
    satisfaction: closure?.satisfaction ?? null,
    absentReason: closure?.absentReason ?? null,
    isSwitchboard: req.isSwitchboard,
  });
  if (!verdict.ok) throw new Error(verdict.reason);

  await db.request.update({
    where: { id: requestId },
    data: {
      status: 'resolved',
      resolvedAt: new Date(),
      satisfaction: verdict.satisfaction,
      satisfactionAbsentReason: verdict.absentReason,
    },
  });
  const leg =
    verdict.satisfaction != null
      ? `Family rated ${verdict.satisfaction}/5.`
      : verdict.absentReason
        ? `No rating — ${SATISFACTION_ABSENT_REASONS.find(x => x.key === verdict.absentReason)?.label ?? verdict.absentReason}.`
        : 'Switchboard slip — no satisfaction leg.';
  await log(requestId, actor.id, 'resolved', `${note.trim() || 'Marked resolved.'} ${leg}`);
  // The closure note stays internal; only the state change crosses to the parent face.
  if (req.channel === 'app') await pushToParentApp(req.ref, { kind: 'resolved' });
  bump();
  revalidatePath(`/r/${req.ref}`);
}

/**
 * The QM-D10 second look. Needs the 'triage_approve' grant AND a different person than the
 * filer — two-person means two people. It records that a second person looked; it gates
 * NOTHING: replies and resolution run regardless, and the UI shows a quiet chip, not a lock.
 */
export async function approveTriage(requestId: string) {
  const { actor, req } = await guard(requestId, 'triage_approve');
  if (!needsSecondLook(req.seriousness)) {
    throw new Error('Nothing to approve — this request is below the second-look threshold.');
  }
  if (req.triageApprovedAt) throw new Error('This request already had its second look.');

  // The filer is whoever the trail records as filing — the earliest 'filed' entry with a
  // named actor. Seeded records without one are approvable by anyone holding the grant.
  const filed = await db.activity.findFirst({
    where: { requestId, kind: 'filed', actorId: { not: null } },
    orderBy: { at: 'asc' },
  });
  const second = secondLook(actor.id, filed?.actorId ?? null);
  if (!second.allowed) throw new Error(second.reason);

  await db.request.update({
    where: { id: requestId },
    data: { triageApprovedById: actor.id, triageApprovedAt: new Date() },
  });
  await log(requestId, actor.id, 'triage_approved',
    `Second look complete — ${actor.name} approved the filing (QM-D10).`);
  bump();
  revalidatePath(`/r/${req.ref}`);
}

export async function reopen(requestId: string) {
  const { actor, req } = await guard(requestId, 'resolve');
  await db.request.update({ where: { id: requestId }, data: { status: 'open', resolvedAt: null } });
  await log(requestId, actor.id, 'reopened', 'Reopened.');
  if (req.channel === 'app') await pushToParentApp(req.ref, { kind: 'reopened' });
  bump();
  revalidatePath(`/r/${req.ref}`);
}

/**
 * The 20-second capture. One shape for call / walk-in / WhatsApp / staff-relayed / event —
 * the channel is a field, not a different system.
 */
export async function quickLog(form: FormData) {
  const actor = await currentActor();

  // Channel note (QM-D34(5)): on the `app` channel submission IS filing — a parent picking a
  // category from the deterministic menu needs no triage, so an app submission goes straight
  // to 'open' with its acknowledgement clock started at the submission instant. This form
  // already behaves that way for its staff-captured channels (it creates 'open', never
  // 'unfiled'); the difference is WHO stops the ack clock — see the stamps below.
  const channel = String(form.get('channel') ?? 'call');
  const campus = String(form.get('campus') ?? '');
  if (!campus) throw new Error('Choose which campus this call was about.');
  // Capability + scope in one check (QM-D9/D26): logging a capture is filing.
  const gate = can(actor, 'file', { campusOrgUnitId: campus });
  if (!gate.allowed) throw new Error(gate.reason);

  const subject = String(form.get('subject') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const familyId = String(form.get('familyId') ?? '') || null;
  const doneNow = form.get('doneNow') === 'on';
  if (!subject) throw new Error('Say in a few words what it was about.');

  // Fields the desk already records in its Daily Call Log.
  const callerRelationship = String(form.get('callerRelationship') ?? '') || null;
  const routedToId = String(form.get('routedToId') ?? '') || null;
  const routedToLabel = String(form.get('routedToLabel') ?? '').trim() || null;
  const grade = String(form.get('grade') ?? '').trim() || null;
  const section = String(form.get('section') ?? '').trim() || null;

  if (routedToId) {
    const target = await db.staff.findUnique({ where: { id: routedToId } });
    if (!target) throw new Error('That person is not in the directory.');
  }

  const sug = getClassifier(process.env.CLASSIFIER ?? 'rules')
    .classify({ subject, body, senderIsKnownFamily: Boolean(familyId) });
  const sb = looksLikeSwitchboard(`${subject} ${body}`);

  const now = new Date();
  const ref = `FD-${String(await nextRequestNumber()).padStart(4, '0')}`;
  const id = randomUUID();

  await db.request.create({
    data: {
      id, ref, channel, campusOrgUnitId: campus, familyId,
      subject, body: body || subject,
      originalRecipients: [],
      arrivedAt: now, clockStartsAt: clockStart(now),
      // A staff member just described this in their own words, so a HIGH-confidence suggestion
      // counts as human-confirmed and the item lands triaged. A low-confidence one is left
      // untriaged on purpose — adopting a weak guess silently is how a queue fills with
      // confidently-mislabelled work.
      category: doneNow || sug.confidence === 'high' ? sug.category : null,
      urgency: sug.urgency,
      status: doneNow ? 'resolved' : 'open',
      suggestedCategory: sug.category,
      suggestedUrgency: sug.urgency,
      suggestionReason: sug.reason,
      isVendorNoise: false,
      isSafeguarding: sug.isSafeguarding,
      // A quick-log lands filed (the staff member's own description is the triage), so the
      // QM-D10 seriousness is recorded here exactly as fileRequest records it.
      seriousness: derivedSeriousness({ urgency: sug.urgency, isSafeguarding: sug.isSafeguarding }),
      callerRelationship,
      receivedById: actor.id,
      routedToId,
      routedToLabel: routedToId ? null : routedToLabel,
      grade, section,
      isSwitchboard: sb.yes,
      // A message routed to someone else is owned by THEM — that is the whole point of taking
      // it. Anything the desk keeps stays with the desk.
      ownerId: routedToId ?? actor.id,
      slaDueAt: doneNow ? null : slaDue(now, sug.urgency),
      // Logging through this form IS filing, so the acknowledgement clock starts now
      // (QM-D12) — and on a staff-captured channel the human logging it is, definitionally,
      // also the first human look, so it stops now too: ack reads 'met' with zero wait.
      // If channel='app' ever routes through here, the submitter is the FAMILY, not staff —
      // filed (QM-D34(5)), but nobody has looked, so acknowledgedAt must stay null.
      ackDueAt: doneNow ? null : ackDueFrom(now, DEFAULT_DESK, sug.urgency),
      acknowledgedAt: channel === 'app' ? null : now,
      firstReplyAt: doneNow ? now : null,
      resolvedAt: doneNow ? now : null,
      messages: {
        create: [{
          id: randomUUID(), direction: 'in',
          senderLabel: familyId ? 'Family (logged by staff)' : 'Logged by staff',
          at: now, body: body || subject,
        }],
      },
      activities: {
        create: [
          { id: randomUUID(), at: now, actorId: actor.id, kind: 'filed',
            detail: `Logged from a ${channel} by ${actor.name}${doneNow ? ' — resolved on the spot.' : '.'}` },
          { id: randomUUID(), at: now, kind: 'classified',
            detail: `Suggested "${sug.category}" (${sug.confidence} confidence) — ${sug.reason}` },
        ],
      },
    },
  });

  await recomputeClusters();
  bump();
  return ref;
}

/**
 * Pull new mail. Safe to press repeatedly — every decision keys on the RFC822 Message-ID, so a
 * second run over the same window creates nothing. Since the email-visibility round
 * (2026-08-24) every pass lands on the record as an IngestRun, and a pull that collides with
 * the five-minute timer is refused with a reason rather than run twice.
 */
export async function syncMail() {
  const actor = await currentActor();
  // QM-D9/D26: capability, not the retired isLeadership boolean. Pulling mail lands new items
  // in the shared capture pool, so it rides 'file' — which the desk holds and 'oversight'
  // implies. No resource: the pull is not about any one request.
  const gate = can(actor, 'file');
  if (!gate.allowed) throw new Error(gate.reason);
  const result = await runRecordedIngest({ trigger: 'pull', actorId: actor.id });
  bump();
  revalidatePath('/mailbox');
  return result;
}

/** Re-run coordination detection over everything currently in play. The DB work lives in
 *  lib/clusters.ts so the mailbox timer can share it; this action adds the revalidation a
 *  request context is allowed (and a timer is not). */
export async function recomputeClusters() {
  await recomputeClustersDb();
  bump();
}
