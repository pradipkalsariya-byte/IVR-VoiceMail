// tools/cleanup-mail-requests.ts — the 24-Aug production review's two data corrections.
//
// Run: npx tsx tools/cleanup-mail-requests.ts             preview
//      npx tsx tools/cleanup-mail-requests.ts --apply     writes
//
// PREVIEWS BY DEFAULT, like every write path in this repo family. Both corrections leave an
// Activity leg on each touched record saying exactly what happened and why — nothing is
// deleted, nothing is silent.
//
// 1. PARK the member-account calendar invitations. The 12-Aug pull ran unfiltered, so the
//    mailbox member's own meeting invites ("Invitation: … (Student 11)") became Needs-filing
//    requests and have clogged FSK/FWGS triage since. Future ones are excluded by
//    GMAIL_QUERY; these existing ones are parked as machine traffic — kept on record,
//    out of the queue. Only UNFILED ones are touched: anything a human has since filed is a
//    human decision this script must not reverse.
//
// 2. RETURN the mis-parked parent threads to triage. Five real parent threads were parked as
//    "vendor" by the early classifier state ("sender is not a known family" — because
//    senderEmail did not exist yet). They go back to Needs filing for a HUMAN to file — this
//    script deliberately does not file them anywhere itself.

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { slaDue } from '../core/sla';
import type { Urgency } from '../core/taxonomy';

const APPLY = process.argv.includes('--apply');
const db = new PrismaClient();

/** The exact refs found mis-parked in the 24-Aug review — a closed list, never a pattern:
 *  "looks like a parent thread" is precisely the judgment this script must not automate. */
const MISPARKED_REFS = ['FD-0192', 'FD-0194', 'FD-0195', 'FD-0196', 'FD-0197'];

async function main() {
  console.log(APPLY ? 'APPLY MODE — writing.' : 'Preview only — run with --apply to write.\n');

  // ---- 1. Calendar invites ------------------------------------------------------------
  const invites = await db.request.findMany({
    where: {
      channel: 'email',
      status: 'unfiled',
      AND: [
        { OR: [{ subject: { startsWith: 'Invitation:' } }, { subject: { startsWith: 'Updated invitation:' } }] },
        { subject: { contains: '(Student 11)' } },
      ],
    },
    select: { id: true, ref: true, subject: true, campusOrgUnitId: true },
    orderBy: { ref: 'asc' },
  });
  console.log(`Calendar invites to park: ${invites.length}`);
  for (const r of invites) console.log(`  ${r.ref}  [${r.campusOrgUnitId}]  ${r.subject.slice(0, 80)}`);

  // ---- 2. Mis-parked parent threads ---------------------------------------------------
  const misparked = await db.request.findMany({
    // Both guards, so a row a human has since acted on is left alone: still parked, still
    // wearing the vendor flag this script exists to remove.
    where: { ref: { in: MISPARKED_REFS }, status: 'not_a_request', isVendorNoise: true },
    select: { id: true, ref: true, subject: true, arrivedAt: true, urgency: true, slaDueAt: true },
    orderBy: { ref: 'asc' },
  });
  console.log(`\nMis-parked parent threads to return to Needs filing: ${misparked.length}`);
  for (const r of misparked) console.log(`  ${r.ref}  ${r.subject.slice(0, 80)}`);
  const skipped = MISPARKED_REFS.filter(ref => !misparked.some(r => r.ref === ref));
  if (skipped.length) {
    console.log(`  (not in the expected state, untouched: ${skipped.join(', ')})`);
  }

  if (!APPLY) {
    console.log('\nPreview only. Nothing written.');
    return;
  }

  for (const r of invites) {
    await db.request.update({
      where: { id: r.id },
      data: {
        status: 'not_a_request',
        isAutomated: true,
        activities: {
          create: [{
            id: randomUUID(), at: new Date(), kind: 'note',
            detail:
              'Parked by the 24-Aug-2026 cleanup: a calendar invitation addressed to the mailbox '
              + 'member account, not a parent request. Future ones are excluded by the mailbox filter.',
          }],
        },
      },
    });
  }
  console.log(`\nParked ${invites.length} invites.`);

  for (const r of misparked) {
    await db.request.update({
      where: { id: r.id },
      data: {
        status: 'unfiled',
        isVendorNoise: false,
        // The vendor parking never got a response clock; restore the one ingestion would
        // have set, computed from the ORIGINAL arrival — honest about the elapsed wait.
        slaDueAt: r.slaDueAt ?? slaDue(r.arrivedAt, r.urgency as Urgency),
        activities: {
          create: [{
            id: randomUUID(), at: new Date(), kind: 'note',
            detail:
              'Returned to Needs filing by the 24-Aug-2026 review: a real parent thread had been '
              + 'parked as vendor mail (the early classifier read an unlinked sender as "not a known '
              + 'family"). A person files it from here.',
          }],
        },
      },
    });
  }
  console.log(`Returned ${misparked.length} threads to Needs filing.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
