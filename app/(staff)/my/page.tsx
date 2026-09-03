import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import {
  AckBadge, AddressTag, Card, CategoryChip, ChannelChip, Chip, NewBadge, Quiet, SectionTitle, SlaBadge, Stat,
} from '@/components/bits';
import { ClaimButton } from '@/components/ClaimButton';
import { bucketMyWork } from '@/core/my-work';
import { readClocks } from '@/core/clocks';
import { humanGap } from '@/core/sla';
import { urgencyLabel, senderAddressLabel, senderIdentityLabel } from '@/core/labels';
import { listProjection, type ActorGrants } from '@/core/permissions';
import { contributedRow, poolItems, type ContributedRow } from '@/core/work-list';

export const dynamic = 'force-dynamic';

type Row = Prisma.RequestGetPayload<{ include: { family: true; campus: true } }>;

export default async function MyWork() {
  const actor = await currentActor();
  const now = new Date();

  // ONE read. Ownership is the admission ticket — no campus filter, because owning a request
  // IS the work claim (a vendor owner has no campus posting at all, R3-23). The aboutStaffIds
  // exclusion is applied HERE as well as in bucketMyWork: same exclusion as the pure layer,
  // repeated at the database because the database is the widest seam — a record closed to
  // this person (QM-D33) is filtered before it ever crosses the wire, and the pure layer's
  // own check stays as the second lock rather than the only one.
  const rows: Row[] = await db.request.findMany({
    where: {
      ownerId: actor.id,
      NOT: { aboutStaffIds: { has: actor.id } },
    },
    include: { family: true, campus: true },
    orderBy: { arrivedAt: 'desc' },
  });

  // QM-D32: no category filter and no complaints section anywhere on this page — a complaint
  // routed to this person is ordinary work in these buckets, treated exactly like a bus query.
  const b = bucketMyWork(rows, actor.id, now);

  // The claimable pool (QM-D31): unowned live queue items on the campuses this actor can
  // see. Unlike the ownership read above, this one IS campus-scoped — ownership was that
  // read's work claim, and these rows have no owner, so scope is the only thing standing
  // between the actor and every campus's queue. Same double-lock shape as the aboutStaffIds
  // exclusion: the database filters at the widest seam, poolItems re-applies the identical
  // selection in the pure layer.
  const campusIds = await visibleCampusIds(actor);
  const poolRows = await db.request.findMany({
    where: {
      ownerId: null,
      status: { in: ['open', 'waiting'] },
      campusOrgUnitId: { in: campusIds },
      NOT: { aboutStaffIds: { has: actor.id } },
    },
  });

  // Rendered FROM the QM-D29 seven-field row, deliberately — this section dogfoods the wire
  // shape, so the page cannot reach past the row into the request for anything beyond the id
  // the claim button needs. listProjection is NOT applied here: suppression already happened
  // inside contributedRow (null — no row), and a masked claimable row would be exactly the
  // sanitised-title R3-19 forbids on a surface this wide.
  const pool = poolItems(poolRows, actor.id)
    .map(r => ({ id: r.id, row: contributedRow({ ...r, ownerName: null }) }))
    .filter((x): x is { id: string; row: ContributedRow } => x.row !== null);

  const unseenOverdue = b.awaitingFirstLook.some(r => readClocks(r, now).ackState === 'overdue');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Quiet>{actor.name} · {actor.roleLabel}</Quiet>
          <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">My work <NewBadge /></h1>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            value={b.awaitingFirstLook.length}
            label="awaiting your first look"
            tone={b.awaitingFirstLook.length === 0 ? 'green' : unseenOverdue ? 'deepred' : 'amber'}
          />
          <Stat value={b.openWork.length} label="open and in hand" tone="blue" />
          <Stat value={b.waitingOnFamily.length} label="waiting on the family" tone="teal" />
          <Stat value={b.recentlyResolved.length} label="resolved this week" tone="green" />
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <SectionTitle note="Filed to you and no one has looked yet — most overdue first.">
          Awaiting your first look
        </SectionTitle>
        {b.awaitingFirstLook.length === 0 && (
          <p className="text-subtle text-sm">Nothing waiting on you.</p>
        )}
        {b.awaitingFirstLook.map(r => (
          <WorkCard key={r.id} r={r} actor={actor} now={now} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle note="Acknowledged and in progress — urgency first, then how close the target is.">
          Open work
        </SectionTitle>
        {b.openWork.length === 0 && (
          <p className="text-subtle text-sm">No open work in your name.</p>
        )}
        {b.openWork.map(r => (
          <WorkCard key={r.id} r={r} actor={actor} now={now} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle note="The next move is the family's; the reply clock shows where things stand.">
          Waiting on the family
        </SectionTitle>
        {b.waitingOnFamily.length === 0 && (
          <p className="text-subtle text-sm">Nothing is waiting on a family.</p>
        )}
        {b.waitingOnFamily.map(r => (
          <WorkCard key={r.id} r={r} actor={actor} now={now} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle note="Closed in the last seven days, then it drops off the stream.">
          Recently resolved
        </SectionTitle>
        {b.recentlyResolved.length === 0 && (
          <p className="text-subtle text-sm">Nothing resolved in the last seven days.</p>
        )}
        {b.recentlyResolved.map(r => (
          <WorkCard key={r.id} r={r} actor={actor} now={now} closed />
        ))}
      </section>

      {/* QM-D31's accepted cost: claimable-versus-mine must be unmistakable on sight.
          Everything above is solid cards — MY work; this section is dashed borders on
          sunken ground — the queue's work, standing where I can take it. */}
      <section className="flex flex-col gap-3">
        <SectionTitle note="Unowned queue items on your campuses — not yours until you claim one. Each keeps its queue's target, and claiming makes that target yours.">
          Claimable in your scope <NewBadge />
        </SectionTitle>
        {pool.length === 0 && (
          <p className="text-subtle text-sm">Nothing unowned is waiting on your campuses.</p>
        )}
        {pool.map(({ id, row }) => (
          <PoolCard key={id} id={id} row={row} now={now} />
        ))}
      </section>
    </div>
  );
}

/** Same table as the queue's urgency stripes, as chip tones — the pool card has no stripe. */
const PRIORITY_TONE: Record<string, string> = {
  critical: 'deepred', high: 'rust', normal: 'ink', low: 'ink',
};

/**
 * A claimable row. Its props are the seven QM-D29 fields plus the id the claim needs —
 * nothing from the request can reach this card that is not on the wire. No ChannelChip, no
 * preview, no family: those are not row fields, and their absence here is the point.
 */
function PoolCard({ id, row, now }: { id: string; row: ContributedRow; now: Date }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-sunken p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <CategoryChip category={row.itemType} />
        <Chip tone={PRIORITY_TONE[row.priority] ?? 'ink'}>{urgencyLabel(row.priority)}</Chip>
        <Link
          href={`/r/${row.ref}`}
          className="font-semibold text-lg hover:underline flex-1 min-w-[240px]"
        >
          {row.title || <span className="italic text-subtle">(no subject)</span>}
        </Link>
        {/* The inherited queue target (QM-D31), rendered from dueTarget alone. */}
        {row.dueTarget === null ? (
          <span className="text-xs text-subtle">no queue target</span>
        ) : +row.dueTarget < +now ? (
          <span className="text-xs font-semibold text-danger">
            queue target {humanGap(row.dueTarget, now)} past
          </span>
        ) : (
          <span className="text-xs text-muted">
            queue target in {humanGap(now, row.dueTarget)}
          </span>
        )}
        <ClaimButton requestId={id} />
      </div>
      <div className="mt-2">
        <Quiet>
          {row.module} · {row.ref} · {row.ownerName ?? 'no owner yet — yours if you take it'}
        </Quiet>
      </div>
    </div>
  );
}

function WorkCard({ r, actor, now, closed = false }: {
  r: Row;
  actor: ActorGrants;
  now: Date;
  closed?: boolean;
}) {
  // Same masking as the queue: a list row is the widest surface in the app, so it carries the
  // least. Owning a safeguarding case does not imply the named grant — an owner without it
  // still gets the masked line here (listProjection's keep-the-row rule; contrast the
  // suppress-the-row exclusion above, which is about complaints, not safeguarding).
  const shown = listProjection(actor, r);
  return (
    <Card stripe={r.urgency} className="p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <ChannelChip channel={r.channel} />
        <CategoryChip category={r.category} />
        {r.isSwitchboard && <Chip tone="ink">Message passed on</Chip>}
        {r.isSafeguarding && <Chip tone="deepred">Safeguarding</Chip>}
        <Link
          href={`/r/${r.ref}`}
          className={`font-semibold text-lg hover:underline flex-1 min-w-[240px] ${shown.masked ? 'italic text-subtle' : ''}`}
        >
          {shown.subject || <span className="italic text-subtle">(no subject)</span>}
        </Link>
        {closed && r.resolvedAt ? (
          <span className="text-xs font-medium text-success">
            resolved {humanGap(r.resolvedAt, now)} ago
          </span>
        ) : (
          <>
            <AckBadge req={r} now={now} />
            <SlaBadge dueAt={r.slaDueAt} firstReplyAt={r.firstReplyAt} now={now} />
          </>
        )}
      </div>
      <p className="text-sm text-muted mt-2 line-clamp-2">{shown.preview}</p>
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <Quiet>{r.campus.code.toUpperCase()} · {senderIdentityLabel(shown, r.family, r.senderEmail, 'unknown sender')} · {r.ref}</Quiet>
        <AddressTag address={senderAddressLabel(shown, r.senderEmail)} />
      </div>
    </Card>
  );
}
