'use server';

// The PARENT's server actions (QM-D34). Every one derives its family from the server session
// seam (lib/family-session.ts), never from a form field, and checks ownership on the
// requestId before touching it — R3-14 applied to the parent face exactly as app/actions.ts
// applies it to the staff face.

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { nextRequestNumber } from '@/lib/ref';
import { FAMILY_COOKIE, currentFamily } from '@/lib/family-session';
import { appSubmission } from '@/core/app-rail';
import { recomputeClusters } from '@/app/actions';

const bumpFamily = (ref?: string) => {
  revalidatePath('/family');
  if (ref) revalidatePath(`/family/r/${ref}`);
  // The same item is the staff face (QM-D34: one record, two faces), so the desk's lists
  // refresh with it.
  revalidatePath('/');
  revalidatePath('/patterns');
  revalidatePath('/oversight');
};

export async function setFamily(id: string) {
  const jar = await cookies();
  jar.set(FAMILY_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/family');
}

/**
 * The parent raises a request. Per QM-D34(5) submission IS filing: the parent picked the
 * category from the deterministic menu (SD-COM-3), which is the routing act filing exists to
 * perform — so the item lands 'open' with both clocks running and no triage stop. The whole
 * field shape comes from core/app-rail.ts's appSubmission, the same pure function the tests
 * pin, so this action cannot drift from the ruling it implements.
 */
export async function submitRequest(form: FormData) {
  const family = await currentFamily();

  const category = String(form.get('category') ?? '');
  const subject = String(form.get('subject') ?? '').trim();
  const body = String(form.get('body') ?? '').trim();
  const grade = String(form.get('grade') ?? '').trim() || null;
  const section = String(form.get('section') ?? '').trim() || null;
  if (!subject) throw new Error('Give your request a few words of subject.');
  if (!body) throw new Error('Say what you need — the message is the request.');

  const now = new Date();
  // The classifier runs INSIDE appSubmission, as a suggestion only: safeguarding detection is
  // content-based (R3-18) and the urgency is its suggestion — but the assistant never
  // overrides the parent's routing. The parent's pick stands as the filed category; the
  // suggestion lands beside it for staff to see (AI-13/15).
  const { suggestionConfidence, ...fields } = appSubmission(now, category, { subject, body });

  const ref = `FD-${String(await nextRequestNumber()).padStart(4, '0')}`;

  await db.request.create({
    data: {
      id: randomUUID(),
      ref,
      ...fields,
      // Campus comes from the signed-in family, never from the client (the app rail's twin of
      // "actor from the session"): the family record already knows where the child is.
      campusOrgUnitId: family.campusOrgUnitId,
      familyId: family.id,
      originalRecipients: [],
      grade,
      section,
      messages: {
        create: [{ id: randomUUID(), direction: 'in', senderLabel: family.label, at: now, body }],
      },
      activities: {
        create: [
          {
            id: randomUUID(), at: now, kind: 'filed',
            detail: `Submitted from the app by ${family.label} — filed on submission, pre-routed to "${fields.category}" by the family's own menu pick (QM-D34(5)).`,
          },
          {
            id: randomUUID(), at: now, kind: 'classified',
            detail: `Suggested "${fields.suggestedCategory}" (${suggestionConfidence} confidence) — ${fields.suggestionReason}`,
          },
        ],
      },
    },
  });

  // An app submission joins coordination detection like any channel — a templated subject is
  // a templated subject whether it arrived by mail or through the menu.
  await recomputeClusters();
  bumpFamily(ref);
  return ref;
}

/**
 * The family writes into their own thread. Direction 'in', and 'waiting' returns to 'open' —
 * the ball is back with the desk. firstReplyAt is NEVER touched here: it records OUR first
 * reply to them, the event the response clock measures, and a family message cannot move it.
 */
export async function familyReply(requestId: string, body: string) {
  const family = await currentFamily();
  const req = await db.request.findUnique({ where: { id: requestId } });
  // One refusal for "not found" and "not yours": knowing a reference is not permission to
  // learn whether it exists, either (R3-14).
  if (!req || req.familyId !== family.id) {
    throw new Error('That request is not on your family’s account, so there is nothing to reply to here.');
  }
  if (req.status === 'resolved') {
    throw new Error(
      'This request is closed. If something is still wrong — or new — raise a fresh request ' +
        'from My requests, so it gets its own clock rather than hiding inside a closed one.',
    );
  }
  // A parked record surfaces in NO staff list (the queue shows unfiled/open/waiting only), so
  // a reply written into it would land where nobody looks — swallowed, with the parent
  // believing they spoke to the school. Refuse toward a fresh request, which gets a clock and
  // a human, rather than accept a message no queue will ever resurface.
  if (req.status === 'not_a_request') {
    throw new Error(
      'This record was closed without action, so nobody is watching it any more. Raise a ' +
        'fresh request from My requests instead — it will get its own clock and a person.',
    );
  }
  const text = body.trim();
  if (!text) throw new Error('A reply needs some text.');

  const at = new Date();
  await db.requestMessage.create({
    data: { id: randomUUID(), requestId, direction: 'in', senderLabel: family.label, at, body: text },
  });
  await db.request.update({
    where: { id: requestId },
    data: { status: req.status === 'waiting' ? 'open' : req.status },
  });
  await db.activity.create({
    data: {
      id: randomUUID(), requestId, actorId: null, at, kind: 'note',
      detail: `The family replied from the app (${text.length} characters) — back with the school.`,
    },
  });
  bumpFamily(req.ref);
}

/**
 * The QM-D18 rating, from its natural home: the family, in their own thread, after resolution.
 *
 * A LATE rating — one arriving after the desk closed under a coded absence reason — still
 * fills the null: the satisfaction figure improves whenever the family actually speaks,
 * however late. The absence reason is NOT cleared: it is the closure-time record of what the
 * desk knew when it closed, and history is not rewritten because better news arrived later.
 */
export async function rateResolved(requestId: string, rating: number) {
  const family = await currentFamily();
  const req = await db.request.findUnique({ where: { id: requestId } });
  if (!req || req.familyId !== family.id) {
    throw new Error('That request is not on your family’s account, so there is nothing to rate here.');
  }
  if (req.status !== 'resolved') {
    throw new Error('Only a resolved request can be rated — this one is still in motion.');
  }
  if (req.satisfaction != null) {
    throw new Error('This request already carries your rating — it is recorded once.');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`A satisfaction rating is 1–5; got ${rating}.`);
  }

  await db.request.update({ where: { id: requestId }, data: { satisfaction: rating } });
  await db.activity.create({
    data: {
      id: randomUUID(), requestId, actorId: null, at: new Date(), kind: 'note',
      detail: `Family rated ${rating}/5 from the app.`,
    },
  });
  bumpFamily(req.ref);
}
