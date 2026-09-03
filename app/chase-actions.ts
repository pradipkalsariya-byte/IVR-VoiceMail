'use server';

// app/chase-actions.ts — the chase ladder's one write (QM-D14): the desk logs that it chased.
// Which requests are OWED a chase is never written anywhere — core/chase.ts derives it at
// read time (QM-D15's shape). This file only records the act.

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { currentActor } from '@/lib/session';
import { can } from '@/core/permissions';

/**
 * The outcome records the ACT — "reached the owner", "left a message", "walked to the
 * classroom" — never the story. The cap is part of that: anything long enough to retell the
 * complaint does not fit, and the story already has a home on the request itself.
 */
const OUTCOME_MAX = 140;

export async function logChase(requestId: string, outcome: string) {
  const actor = await currentActor();
  const req = await db.request.findUnique({ where: { id: requestId } });
  if (!req) throw new Error('Request not found.');

  // Same seam as app/actions.ts's guard: the actor comes from the SERVER session, never a
  // form field (cardinal rule 5), and capability + campus scope are checked per action
  // (QM-D9/D26). isAboutActor is included: someone a complaint is ABOUT is outside its
  // audience entirely (QM-D33), chasing included.
  //
  // isSafeguarding is DELIBERATELY not passed. A chase carries the reference and nothing
  // else — the Chase model has no narrative columns, so logging one on a Tier-2 record
  // widens its audience by exactly nothing (constraint 3 holds structurally). Requiring the
  // named grant here would instead make safeguarding cases the one class the desk cannot
  // chase — inverting R3-4's purpose. Everywhere content flows, the record stays gated.
  // Divergence from every other action guard consciously RATIFIED at integration
  // (2026-08-08), after the verify pass confirmed structurally that outcome text renders
  // nowhere and the 'chased' trail leg sits behind the record page's full gate stack.
  const decision = can(actor, 'file', {
    campusOrgUnitId: req.campusOrgUnitId,
    isOwnedByActor: req.ownerId === actor.id,
    isAboutActor: req.aboutStaffIds.includes(actor.id),
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const text = outcome.trim();
  if (!text) {
    throw new Error(
      'Say what the chase did — "reached the owner", "left a message". The act, never the story.',
    );
  }
  if (text.length > OUTCOME_MAX) {
    throw new Error(
      `Keep the outcome under ${OUTCOME_MAX} characters — a chase records the act, and the ` +
        'story belongs on the request, not here.',
    );
  }

  // DELIBERATELY no "is this request currently owed a chase?" refusal. The OWED list
  // (core/chase.ts) is derived guidance, not a lock — the desk may chase early, and refusing
  // an act of diligence because a clock disagrees would teach people the strip is a cage.
  // What is derived stays derived; what is logged is whatever the desk actually did.

  const now = new Date();
  await db.chase.create({
    data: {
      id: randomUUID(),
      requestId,
      campusOrgUnitId: req.campusOrgUnitId,
      // Opened and closed in one act: in the prototype the desk logs a chase at the moment
      // it is done. A chase that stays open while the owner is hunted is the real module's
      // shape; here the act and its outcome arrive together.
      openedAt: now,
      closedAt: now,
      closedById: actor.id,
      outcome: text,
    },
  });

  // The trail leg lands on the REQUEST — everything after filing lives on the record
  // (R3-18 ext). 'chased' extends the Activity.kind list the schema comment enumerates,
  // the same way 'conveyed' did.
  await db.activity.create({
    data: {
      id: randomUUID(), requestId, actorId: actor.id, at: now, kind: 'chased',
      detail: `Chased — ${text}. Finding the owner is not resolving the request (QM-D14).`,
    },
  });

  // NEVER touches Request.status: closing the chase never closes the item (QM-D14
  // constraint 2) — two separate lifecycles, and only one of them ended here.

  revalidatePath('/');
  revalidatePath('/oversight');
  revalidatePath(`/r/${req.ref}`);
}
