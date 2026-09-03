// POST /api/bridge/requests — the Nucleus parent app files a front-office thread onto THIS
// spine (QM-D34(2): the Front Office catch-all IS the front desk; one record, two faces).
//
// Dormant unless PARENT_BRIDGE_SECRET is set: without it the route answers 404, so a deploy
// with no bridge configured — production today — carries no new surface at all. The payload is
// synthetic demo data from the parent app's seeded family (cardinal rule 2 holds: the bridge is
// local-to-local; production wiring is a separate, explicit decision).

import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { nextRequestNumber } from '@/lib/ref';
import { recomputeClustersDb } from '@/lib/clusters';
import { appSubmission } from '@/core/app-rail';
import { mapBridgeCategory, parseBridgeIntake, secretMatches } from '@/core/bridge';

export async function POST(req: NextRequest) {
  const secret = process.env.PARENT_BRIDGE_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!secretMatches(secret, req.headers.get('x-bridge-secret'))) {
    return NextResponse.json({ reason: 'Bad bridge secret.' }, { status: 401 });
  }

  const parsed = parseBridgeIntake(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ reason: parsed.reason }, { status: 400 });
  const intake = parsed.value;

  const campus = await db.orgUnit.findFirst({ where: { code: intake.campus, type: 'CAMPUS' } });
  if (!campus) return NextResponse.json({ reason: `Unknown campus code "${intake.campus}".` }, { status: 400 });

  // The identity seam: the parent app's signed-in email IS the family key, same as the email
  // rail. First contact creates the family row — exactly what ingest does for a new sender.
  const family = await db.family.upsert({
    where: { emailKey: intake.familyEmailKey },
    update: {},
    create: {
      id: randomUUID(),
      label: intake.familyLabel,
      emailKey: intake.familyEmailKey,
      campusOrgUnitId: campus.id,
    },
  });

  // Same shape, same pure function, same ruling as the in-app /family submission — the
  // category crosses the vocabulary seam first (mapBridgeCategory), then QM-D34(5) applies:
  // submission IS filing, both clocks anchored now, no triage stop.
  const now = new Date();
  const { suggestionConfidence, ...fields } = appSubmission(now, mapBridgeCategory(intake.category), {
    subject: intake.subject,
    body: intake.body,
  });

  const ref = `FD-${String(await nextRequestNumber()).padStart(4, '0')}`;
  await db.request.create({
    data: {
      id: randomUUID(),
      ref,
      ...fields,
      campusOrgUnitId: campus.id,
      familyId: family.id,
      originalRecipients: [],
      grade: intake.grade,
      section: intake.section,
      messages: {
        create: [{ id: randomUUID(), direction: 'in', senderLabel: family.label, at: now, body: intake.body }],
      },
      activities: {
        create: [
          {
            id: randomUUID(), at: now, kind: 'filed',
            detail: `Submitted from the Nucleus parent app by ${family.label} — filed on submission, pre-routed to "${fields.category}" by the family's own menu pick (QM-D34(5)).`,
          },
          {
            id: randomUUID(), at: now, kind: 'classified',
            detail: `Suggested "${fields.suggestedCategory}" (${suggestionConfidence} confidence) — ${fields.suggestionReason}`,
          },
        ],
      },
    },
  });

  await recomputeClustersDb();
  revalidatePath('/');
  revalidatePath('/patterns');
  revalidatePath('/oversight');

  return NextResponse.json({ ref, ackDueAt: fields.ackDueAt.toISOString() }, { status: 201 });
}
