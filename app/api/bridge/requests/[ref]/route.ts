// POST /api/bridge/requests/[ref] — the family acted on an existing bridged request from the
// parent app: replied, rated, or escalated. The write mirrors app/family-actions.ts leg for
// leg (same refusals, same trail wording) — the only difference is WHO vouches for the family:
// there the cookie session, here the shared secret plus the request's own family linkage.

import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { parseBridgeEvent, secretMatches } from '@/core/bridge';

const bump = (ref: string) => {
  revalidatePath('/');
  revalidatePath('/patterns');
  revalidatePath('/oversight');
  revalidatePath(`/r/${ref}`);
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const secret = process.env.PARENT_BRIDGE_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!secretMatches(secret, req.headers.get('x-bridge-secret'))) {
    return NextResponse.json({ reason: 'Bad bridge secret.' }, { status: 401 });
  }

  const parsed = parseBridgeEvent(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ reason: parsed.reason }, { status: 400 });
  const event = parsed.value;

  const { ref } = await ctx.params;
  // Only a request that CAME over the bridge takes bridge events — channel 'app' with a linked
  // family. One refusal for "not found" and "not bridged" (R3-14's shape at the seam).
  const request = await db.request.findFirst({
    where: { ref, channel: 'app', familyId: { not: null } },
    include: { family: true },
  });
  if (!request) return NextResponse.json({ reason: 'No bridged request under that reference.' }, { status: 404 });
  const at = new Date();

  if (event.kind === 'message') {
    if (request.status === 'resolved' || request.status === 'not_a_request') {
      return NextResponse.json({ reason: 'This request is closed — raise a fresh one.' }, { status: 409 });
    }
    await db.requestMessage.create({
      data: { id: randomUUID(), requestId: request.id, direction: 'in', senderLabel: request.family!.label, at, body: event.body },
    });
    await db.request.update({
      where: { id: request.id },
      data: { status: request.status === 'waiting' ? 'open' : request.status },
    });
    await db.activity.create({
      data: {
        id: randomUUID(), requestId: request.id, actorId: null, at, kind: 'note',
        detail: `The family replied from the app (${event.body.length} characters) — back with the school.`,
      },
    });
  } else if (event.kind === 'rating') {
    if (request.status !== 'resolved') {
      return NextResponse.json({ reason: 'Only a resolved request can be rated.' }, { status: 409 });
    }
    if (request.satisfaction != null) {
      return NextResponse.json({ reason: 'This request already carries a rating.' }, { status: 409 });
    }
    await db.request.update({ where: { id: request.id }, data: { satisfaction: event.rating } });
    await db.activity.create({
      data: {
        id: randomUUID(), requestId: request.id, actorId: null, at, kind: 'note',
        detail: `Family rated ${event.rating}/5 from the app.`,
      },
    });
  } else {
    // SD-COM-11 / QM-D34(4): ONE escalation ladder. The parent app enforces once-per-thread on
    // its face; here the flag lands on the trail so the desk sees it where it works.
    await db.activity.create({
      data: {
        id: randomUUID(), requestId: request.id, actorId: null, at, kind: 'escalated',
        detail: 'The family escalated this thread from the app — the office head is on it at the next level.',
      },
    });
  }

  bump(ref);
  return NextResponse.json({ ok: true });
}
