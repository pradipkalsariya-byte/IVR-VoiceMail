import Link from 'next/link';
import { db } from '@/lib/db';
import { listProjection, type ActorGrants } from '@/core/permissions';
import { belongsInQueue } from '@/core/queue-window';
import { slaState } from '@/core/sla';
import { urgencyLabel } from '@/core/labels';
import { Quiet } from '@/components/bits';

// The reading-pane rail (30-Aug-2026, the estate work-surfaces round — DS §54, .fh-split):
// the live queue alongside the open record, so working through the pile is next-click, not
// back-and-forth. SELECTION IS THE URL — the row anchors are the same /r/<ref> links the
// queue page has always used, so every deep link keeps working and opening a row files
// NOTHING (rule 3: the assistant never acts; neither does navigation).
//
// The rail renders only after the record page's own gates have passed, and applies the
// queue page's own projection rules to its rows: about-actor rows are suppressed entirely
// (QM-D33 — even a masked row would leak that a complaint exists), safeguarding subjects
// mask through listProjection unless the viewer holds the named grant, switchboard slips
// and pre-window unfiled mail stay out (core/queue-window). Nothing here widens any
// record's audience beyond what the queue page already shows.

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const RAIL_CAP = 40; // per group; the row below the cap says how many it is holding back

interface RailRow {
  id: string;
  ref: string;
  subject: string;
  masked: boolean;
  campusCode: string;
  note: string | null;
  noteTone: 'danger' | 'quiet';
}

function Row({ r, current }: { r: RailRow; current: boolean }) {
  return (
    <Link
      href={`/r/${r.ref}`}
      aria-current={current ? 'page' : undefined}
      className={`fh-split__row${current ? ' is-selected' : ''}`}
    >
      <span className={`block text-sm font-medium leading-snug line-clamp-1 ${r.masked ? 'italic text-subtle' : ''}`}>
        {r.subject || <span className="italic text-subtle">(no subject)</span>}
      </span>
      <span className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
        <span>{r.ref} · {r.campusCode}</span>
        {r.note && (
          <span className={r.noteTone === 'danger' ? 'font-semibold text-danger' : ''}>{r.note}</span>
        )}
      </span>
    </Link>
  );
}

export async function QueueRail({
  actor,
  campusIds,
  currentRef,
}: {
  actor: ActorGrants & { id: string };
  campusIds: string[];
  currentRef: string;
}) {
  const now = new Date();
  const rows = await db.request.findMany({
    where: {
      campusOrgUnitId: { in: campusIds },
      NOT: { aboutStaffIds: { has: actor.id } },
      status: { in: ['unfiled', 'open', 'waiting'] },
    },
    select: {
      id: true, ref: true, subject: true, body: true, status: true, urgency: true,
      isSafeguarding: true, isVendorNoise: true, isSwitchboard: true, ownerId: true,
      arrivedAt: true, slaDueAt: true, firstReplyAt: true, campusOrgUnitId: true,
      campus: { select: { code: true } },
    },
    orderBy: { arrivedAt: 'desc' },
  });

  const inQueue = rows.filter(r => belongsInQueue(r, now));
  const toRow = (r: (typeof rows)[number], note: string | null, noteTone: 'danger' | 'quiet'): RailRow => {
    const shown = listProjection(actor, r);
    return { id: r.id, ref: r.ref, subject: shown.subject, masked: shown.masked, campusCode: r.campus.code.toUpperCase(), note, noteTone };
  };

  const unfiled = inQueue
    .filter(r => r.status === 'unfiled' && !r.isVendorNoise)
    .map(r => toRow(r, null, 'quiet'));
  const working = inQueue
    .filter(r => r.status === 'open' || r.status === 'waiting')
    .sort((a, b) => {
      const ua = (URGENCY_RANK[a.urgency] ?? 4) - (URGENCY_RANK[b.urgency] ?? 4);
      if (ua !== 0) return ua;
      return (a.slaDueAt?.getTime() ?? 9e15) - (b.slaDueAt?.getTime() ?? 9e15);
    })
    .map(r =>
      toRow(
        r,
        slaState({ dueAt: r.slaDueAt, firstReplyAt: r.firstReplyAt, now }) === 'breached'
          ? 'past target'
          : urgencyLabel(r.urgency),
        slaState({ dueAt: r.slaDueAt, firstReplyAt: r.firstReplyAt, now }) === 'breached' ? 'danger' : 'quiet',
      ),
    );

  const groups: { title: string; rows: RailRow[] }[] = [
    { title: 'Needs filing', rows: unfiled },
    { title: 'Working queue', rows: working },
  ];

  return (
    // Hidden below the DS split's own 1024px stack point: on a phone the deep-linked record
    // is what was asked for, and the full queue is one tap away — stacking the whole queue
    // ABOVE the record (the split's default, built for index pages) would bury it.
    <aside className="fh-split__queue hidden lg:block" aria-label="The queue">
      <div className="fh-card p-0 overflow-hidden">
        <div className="flex items-baseline justify-between gap-2 px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">The queue</span>
          <Link href="/" className="text-xs text-primary underline hover:no-underline">Full view</Link>
        </div>
        {groups.map(g => (
          <div key={g.title}>
            <div className="px-4 pt-3 pb-1">
              <Quiet>{g.title} · {g.rows.length}</Quiet>
            </div>
            {g.rows.length === 0 && (
              <p className="px-4 pb-3 text-xs text-subtle">Nothing here.</p>
            )}
            {g.rows.slice(0, RAIL_CAP).map(r => (
              <Row key={r.id} r={r} current={r.ref === currentRef} />
            ))}
            {g.rows.length > RAIL_CAP && (
              <Link href="/" className="block px-4 py-2 text-xs text-primary underline hover:no-underline">
                +{g.rows.length - RAIL_CAP} more — open the full queue
              </Link>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
