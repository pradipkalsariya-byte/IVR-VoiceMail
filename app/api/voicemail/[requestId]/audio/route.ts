// GET /api/voicemail/[requestId]/audio — stream a captured voicemail's recording back to a
// signed-in staff member (docs/IVR-VOICEMAIL-BRIEF.md: "the audio attached to the record").
//
// Staff-authenticated, NOT the vendor webhook's shared secret — this mirrors the exact same
// three read gates app/(staff)/r/[ref]/page.tsx already applies before rendering a record at
// all: the QM-D33 about-actor exclusion, campus scope (R3-14: the URL is never an access
// boundary), and safeguarding's named-access gate (Tier-2, R3-4/R3-18). A voicemail recording is
// exactly the kind of content those gates exist to protect, so it gets no lighter a check just
// because it is bytes instead of a page.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { can } from '@/core/permissions';

export async function GET(_req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const actor = await currentActor();

  const r = await db.request.findUnique({
    where: { id: requestId },
    select: {
      campusOrgUnitId: true,
      isSafeguarding: true,
      aboutStaffIds: true,
      voicemailAudio: { select: { audio: true, contentType: true } },
    },
  });
  if (!r || !r.voicemailAudio) return new NextResponse(null, { status: 404 });

  // QM-D33 first, exactly as the record page checks it first — being senior does not put you
  // in the audience of a complaint about you.
  if (r.aboutStaffIds.includes(actor.id)) {
    return NextResponse.json(
      { reason: 'This record concerns you, so it is closed to you (QM-D33).' },
      { status: 403 },
    );
  }

  const campusIds = await visibleCampusIds(actor);
  if (!campusIds.includes(r.campusOrgUnitId)) {
    return NextResponse.json(
      { reason: 'This request belongs to a campus outside your scope.' },
      { status: 403 },
    );
  }

  if (r.isSafeguarding) {
    const view = can(actor, 'view_safeguarding', {
      campusOrgUnitId: r.campusOrgUnitId, isSafeguarding: true,
    });
    if (!view.allowed) return NextResponse.json({ reason: view.reason }, { status: 403 });
  }

  return new NextResponse(r.voicemailAudio.audio, {
    status: 200,
    headers: {
      'Content-Type': r.voicemailAudio.contentType,
      'Content-Length': String(r.voicemailAudio.audio.length),
      // Never cached by a shared/browser disk cache — this is a parent's voicemail, not a static asset.
      'Cache-Control': 'private, no-store',
    },
  });
}
