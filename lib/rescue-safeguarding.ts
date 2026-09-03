import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { CHILD_SAFETY_RE } from '@/core/classify';
import type { Urgency } from '@/core/taxonomy';
import { clockStart, slaDue } from '@/core/sla';

// Bring back safeguarding mail that an earlier classifier buried.
//
// Found live on 27-Aug-2026, on production, while checking whether the classifier fix had
// actually helped. Two messages from one parent alleging a staff member had mocked her
// daughter:
//
//   FD-0780 "URGENT: Immediate action required"  -> status not_a_request, isVendorNoise true.
//                                                   No clock, no owner, in NO staff list.
//   FD-0781 "Re: Disappointed with FWGS"         -> in the queue, but filed `praise`, low.
//
// Fixing the classifier fixes the NEXT one. It does nothing for these, because they are already
// written. A safeguarding message that the app has hidden does not get to wait for the next
// deploy cycle, so this pass re-reads what was set aside and undoes the specific mistake.
//
// It is deliberately narrow -- only CHILD_SAFETY_RE, nothing else. A general "re-file everything
// with the new rules" pass would churn hundreds of records and overrule people's decisions. This
// one exists because safeguarding is the single category where a false negative is unacceptable,
// which is the same reason it is an absolute override in the classifier itself.

export interface RescueSummary {
  examined: number;
  unparked: number;
  flagged: number;
  /** Safeguarding items found in the queue with no response clock, and given one. */
  clocksRestored: number;
  errors: string[];
}

export async function rescueSafeguarding(limit = 200): Promise<RescueSummary> {
  const summary: RescueSummary = { examined: 0, unparked: 0, flagged: 0, clocksRestored: 0, errors: [] };

  const rows = await db.request.findMany({
    where: {
      isSafeguarding: false,
      OR: [
        { status: 'not_a_request' },   // parked out of sight
        { isVendorNoise: true },       // or marked as marketing
        { category: { not: null } },   // or filed as something else
      ],
    },
    select: { id: true, ref: true, subject: true, body: true, status: true, category: true,
              arrivedAt: true },
    orderBy: { arrivedAt: 'desc' },
    take: limit,
  });

  for (const r of rows) {
    summary.examined++;
    if (!CHILD_SAFETY_RE.test(`${r.subject ?? ''} ${r.body ?? ''}`)) continue;

    // Whether a HUMAN chose this record's category is the line this pass will not cross.
    // A parked record was set aside by the machine, so undoing it overrules nobody. A filed
    // one is somebody's decision, and the answer there is to make it visible and let them
    // look again -- not to quietly re-file it (AI-13).
    const machineParked = r.status === 'not_a_request';

    try {
      if (machineParked) {
        await db.request.update({
          where: { id: r.id },
          data: {
            status: 'unfiled',        // back in the queue, UNTRIAGED -- a person still files it
            category: null,
            isVendorNoise: false,
            isSafeguarding: true,
            urgency: 'critical',
            suggestedCategory: 'child-safety',
            suggestionReason: 'Re-read on 27-Aug-2026: the text mentions a child being left, '
              + 'unattended, harassed or humiliated. It had been set aside as vendor mail.',
            clockStartsAt: clockStart(r.arrivedAt),
            // The RESPONSE CLOCK has to come back too, and the first version of this pass
            // forgot it -- caught on production minutes after deploying, when FD-0780 came back
            // into the queue as the only critical item in it with no clock at all. Parking sets
            // slaDueAt to null (nobody owes a robot a reply), so un-parking has to undo that or
            // the item is visible but invisible to every breach report and chase -- which is
            // most of the way back to being hidden.
            slaDueAt: slaDue(r.arrivedAt, 'critical'),
          },
        });
        await db.activity.create({
          data: {
            id: randomUUID(), requestId: r.id, at: new Date(), kind: 'note',
            detail: 'Brought back into the queue. This had been set aside automatically as '
              + 'vendor or marketing mail, but it reads as a safeguarding concern. Nobody has '
              + 'filed it — it needs a person.',
          },
        });
        summary.unparked++;
      } else {
        // Filed by a person as something else. Flag it, do not re-file it.
        await db.request.update({ where: { id: r.id }, data: { isSafeguarding: true } });
        await db.activity.create({
          data: {
            id: randomUUID(), requestId: r.id, at: new Date(), kind: 'note',
            detail: `Marked as a safeguarding concern on a re-read. It is currently filed as `
              + `"${r.category}" — that filing has been left alone, but it is worth a second look.`,
          },
        });
        summary.flagged++;
      }
    } catch (e) {
      summary.errors.push(`${r.ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // An invariant worth enforcing rather than merely honouring: a safeguarding item sitting in
  // the working queue always has a response clock. Anything already flagged but clockless is
  // repaired here -- including rows this pass itself created before the fix above.
  const clockless = await db.request.findMany({
    where: {
      isSafeguarding: true,
      slaDueAt: null,
      status: { in: ['unfiled', 'open', 'waiting'] },
    },
    select: { id: true, ref: true, arrivedAt: true, urgency: true },
    take: limit,
  });

  for (const r of clockless) {
    try {
      await db.request.update({
        where: { id: r.id },
        data: { slaDueAt: slaDue(r.arrivedAt, (r.urgency as Urgency) ?? 'critical') },
      });
      summary.clocksRestored++;
    } catch (e) {
      summary.errors.push(`${r.ref} (clock): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
