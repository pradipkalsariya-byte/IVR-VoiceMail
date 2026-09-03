import Link from 'next/link';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { staffDirectory, staffAssignableAt } from '@/lib/staff';
import { AckBadge, AddressTag, Card, ChannelChip, CategoryChip, Chip, NewBadge, Quiet, SlaBadge, SectionTitle } from '@/components/bits';
import { TriageBar } from '@/components/TriageBar';
import { MailboxStrip } from '@/components/MailboxStrip';
import { ChaseLog } from '@/components/ChaseLog';
import { humanGap, slaState } from '@/core/sla';
import { chasesOwed, chaseTitle } from '@/core/chase';
import { listProjection } from '@/core/permissions';
import { senderAddressLabel, senderIdentityLabel } from '@/core/labels';
import { formatInstantShortIST } from '@/core/dates';
import { belongsInQueue, agedOutCount, queueWindowStart } from '@/core/queue-window';
import { filtersFromParams, matchesFilters, categoryCounts } from '@/core/queue-filters';
import { FilterBar } from '@/components/FilterBar';

export const dynamic = 'force-dynamic';

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export default async function Queue({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; cat?: string; ch?: string; state?: string; q?: string }>;
}) {
  // `?all=1` lifts the age limit (feedback #6). The old switchboard show/hide toggle is gone:
  // those slips have their own page now (feedback #8) rather than being hidden and shown here.
  const sp = await searchParams;
  const { all } = sp;
  const showAllAges = all === '1';
  const filters = filtersFromParams(sp);
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);
  const now = new Date();

  const [campuses, staff, rows, clusters] = await Promise.all([
    db.orgUnit.findMany({ where: { id: { in: campusIds } }, orderBy: { code: 'asc' } }),
    staffDirectory(),
    db.request.findMany({
      // QM-D33: a complaint about the viewer is suppressed as a ROW — deliberately unlike
      // safeguarding's keep-the-row masking (listProjection), because here even a masked row would leak
      // that a complaint about this person exists, and the about-person has no work claim on
      // it that a visible row would serve. The counts derive from this same query, so they
      // stay consistent for free.
      where: { campusOrgUnitId: { in: campusIds }, NOT: { aboutStaffIds: { has: actor.id } } },
      // The latest chase per request feeds the cooldown in chasesOwed — a timestamp, because
      // suppression needs WHEN the desk last chased, not merely that it ever did.
      include: {
        family: true, owner: true, campus: true, cluster: true,
        chases: { orderBy: { openedAt: 'desc' }, take: 1 },
      },
      orderBy: { arrivedAt: 'desc' },
    }),
    db.cluster.findMany({
      where: { isCoordinated: true, campusOrgUnitId: { in: campusIds } },
      include: { requests: { select: { id: true, ref: true, status: true, aboutStaffIds: true } } },
    }),
  ]);

  // Whole-cluster suppression (QM-D33): a cluster's label carries its members' shared
  // wording, so a banner reading "13 messages: <subject>" would leak exactly what the row
  // suppression above hides. If any member concerns the viewer, the banner goes with it.
  const visibleClusters = clusters.filter(
    c => !c.requests.some(r => r.aboutStaffIds.includes(actor.id)),
  );

  // Feedback #6 + #8, applied in ONE place so every count on this page derives from the same
  // set. Switchboard slips are gone entirely (they have their own page); unfiled mail from
  // before 01-Aug-2026 is held back unless ?all=1. Anything filed or owned stays whatever its
  // age — see core/queue-window.ts for why that exception is load-bearing.
  const agedOut = agedOutCount(rows, now);
  const inQueue = rows.filter(r => (showAllAges ? !r.isSwitchboard : belongsInQueue(r, now)));

  // Feedback #11. The counts above stay UNFILTERED on purpose — "9 need filing" has to keep
  // meaning nine, or a filtered view quietly redefines the number the desk plans its day by.
  // The filters narrow the lists below them, and the bar says how many of how many.
  const catCounts = categoryCounts(inQueue, filters);
  const visible = inQueue.filter(r => matchesFilters(r, filters));

  const unfiled = visible.filter(r => r.status === 'unfiled' && !r.isVendorNoise);
  const noise = visible.filter(r => r.status === 'unfiled' && r.isVendorNoise);
  const working = visible
    .filter(r => r.status === 'open' || r.status === 'waiting')
    .sort((a, b) => {
      const ua = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (ua !== 0) return ua;
      return (a.slaDueAt?.getTime() ?? 9e15) - (b.slaDueAt?.getTime() ?? 9e15);
    });

  const allUnfiled = inQueue.filter(r => r.status === 'unfiled' && !r.isVendorNoise);
  const allWorking = inQueue.filter(r => r.status === 'open' || r.status === 'waiting');
  const breached = working.filter(
    r => slaState({ dueAt: r.slaDueAt, firstReplyAt: r.firstReplyAt, now }) === 'breached',
  ).length;
  const unowned = working.filter(r => !r.ownerId).length;

  // The chase ladder (QM-D14): derived from the SAME `working` array the breach stat above
  // counts, so the strip and the "past their target" figure can never disagree.
  const lastChaseAt = new Map(
    working.filter(r => r.chases.length > 0).map(r => [r.id, r.chases[0].openedAt]),
  );
  const owedChases = chasesOwed(working, lastChaseAt, now);
  const workingById = new Map(working.map(r => [r.id, r]));

  return (
    <div className="flex flex-col gap-8">
      {/* Work first (2026-08-09 review): the page opens on what the operator came to do.
          The KPIs are one quiet line, not four tiles. The 2026-08-24 amendment: pipe health
          gets ONE line at the top — VK's review found "is the mailbox even being read?"
          unanswerable with the panel below the fold — and the detail lives on /mailbox. */}
      <div>
        <Quiet>
          {actor.scopeOrgUnitId === 'group'
            ? `All campuses · ${campuses.length}`
            : campuses[0]?.name}
        </Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">The queue</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
          <span><strong className="font-semibold tabular-nums text-foreground">{allUnfiled.length}</strong> need filing</span>
          <span><strong className="font-semibold tabular-nums text-foreground">{allWorking.length}</strong> in the working queue</span>
          <span className={unowned ? 'text-danger font-medium' : ''}>
            <strong className="font-semibold tabular-nums">{unowned}</strong> with no owner
          </span>
          <span className={breached ? 'text-danger font-medium' : ''}>
            <strong className="font-semibold tabular-nums">{breached}</strong> past their target
          </span>
        </div>

        {/* "Nothing is lost" is the promise this whole screen makes, so a date filter cannot be
            silent — an operator who is not told would reasonably conclude the older items had
            been deleted. Feedback #6 asked for the six-year pile to stop cluttering, not for it
            to become unreachable. */}
        {(agedOut > 0 || showAllAges) && (
          <p className="mt-2 text-sm text-subtle">
            {showAllAges ? (
              <>
                Showing everything, including mail that arrived before{' '}
                {formatInstantShortIST(queueWindowStart())} and that nobody has filed.{' '}
                <Link href="/" className="text-primary underline hover:no-underline">
                  Back to the working period
                </Link>
              </>
            ) : (
              <>
                <strong className="font-semibold tabular-nums text-foreground">{agedOut}</strong>{' '}
                unfiled item{agedOut === 1 ? '' : 's'} from before{' '}
                {formatInstantShortIST(queueWindowStart())} {agedOut === 1 ? 'is' : 'are'} held
                back — the desk works from 01-Aug-2026 onward.{' '}
                <Link href="/?all=1" className="text-primary underline hover:no-underline">
                  Show them anyway
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      <FilterBar
        basePath="/"
        filters={filters}
        categoryCounts={catCounts}
        total={inQueue.length}
        shown={visible.length}
      />

      <MailboxStrip />

      {visibleClusters.length > 0 && (
        <div className="flex flex-col gap-3">
          {visibleClusters.map(c => (
            <Card key={c.id} stripe="critical" className="p-4">
              <div className="flex items-start gap-4 flex-wrap">
                <Chip tone="deepred">Looks coordinated</Chip>
                <div className="flex-1 min-w-[280px]">
                  <div className="font-semibold text-base leading-snug">{c.label}</div>
                  <p className="text-sm text-muted mt-1">
                    {c.requests.length} messages arriving together
                    {c.templateHits > 0 && (
                      <>
                        {' '}— <strong>{c.templateHits}</strong> of them pasted a
                        {' '}<code className="bg-surface-sunken px-1 rounded">Subject:</code> line, the signature of a circulated template
                      </>
                    )}
                    .
                  </p>
                </div>
                {/* "Handle together", not "Answer once" — /patterns offers note/assign/resolve
                    across the cluster; a bulk REPLY doesn't exist (yet), and a button must not
                    promise a capability the page it opens cannot deliver (2026-08-09 review). */}
                <Link href="/patterns" className="fh-btn fh-btn--primary fh-btn--sm">
                  Handle together →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle note="Nothing is lost — but only what you file enters the working queue.">
          Needs filing <NewBadge />
        </SectionTitle>
        {unfiled.length === 0 && <p className="text-subtle text-sm">Nothing waiting to be filed.</p>}
        {unfiled.map(r => {
          // A list row is the widest surface in the app, so it carries the least: safeguarding
          // subject lines are masked here unless the actor holds the NAMED grant — the record
          // page's gate was insufficient on its own, because "child left at the bus stop" names
          // the situation from the queue itself.
          const shown = listProjection(actor, r);
          return (
          <Card key={r.id} stripe={r.suggestedUrgency ?? 'normal'} className="p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <ChannelChip channel={r.channel} />
              {r.isSafeguarding && <Chip tone="deepred">Safeguarding</Chip>}
              <Link href={`/r/${r.ref}`} className={`font-semibold text-base hover:underline flex-1 min-w-[240px] ${shown.masked ? 'italic text-subtle' : ''}`}>
                {shown.subject || <span className="italic text-subtle">(no subject)</span>}
              </Link>
              <Quiet>{r.campus.code.toUpperCase()} · {senderIdentityLabel(shown, r.family, r.senderEmail, 'unknown sender')} · {r.ref}</Quiet>
            </div>
            {/* The triage question this card asks is "is this a real parent?" — the raw address
                and the arrival instant are the two facts that answer it (2026-08-24 round). */}
            <div className="mt-1 flex items-center gap-3 flex-wrap">
              <AddressTag address={senderAddressLabel(shown, r.senderEmail)} />
              <span className="text-xs text-subtle whitespace-nowrap">arrived {formatInstantShortIST(r.arrivedAt)}</span>
            </div>
            <p className="text-sm text-muted mt-2 line-clamp-2">{shown.preview}</p>
            <div className="mt-3 rounded-md bg-surface-sunken px-3 py-2">
              <Quiet>Suggestion</Quiet>
              <p className="text-sm text-muted mt-0.5">{r.suggestionReason}</p>
            </div>
            <TriageBar
              requestId={r.id}
              suggestedCategory={r.suggestedCategory}
              suggestedUrgency={r.suggestedUrgency}
              staff={staffAssignableAt(staff, r.campusOrgUnitId).map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
            />
          </Card>
          );
        })}
      </section>

      {owedChases.length > 0 && (
        <section className="flex flex-col gap-3">
          {/* Reference-only is (QM-D14): a chase finds the owner, it never carries the story. */}
          <SectionTitle note="Reference only — a chase finds the owner; it never carries the story.">
            Chases owed <NewBadge />
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {owedChases.map(o => {
              const r = workingById.get(o.id)!;
              return (
                <Card key={o.id} stripe="critical" className="p-4">
                  {/* Reference-only is a RENDERING rule too (HDT-9): no subject, no family
                      label, no category chip may appear on this strip. The row says which
                      reference is late and who should be moving — nothing else, so it can sit
                      on the widest surface in the app without widening any record's audience. */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-base">{chaseTitle(o.ref)}</span>
                    <span className="text-xs font-semibold text-danger">
                      {humanGap(r.slaDueAt!, now)} past target
                    </span>
                    {/* Naming the owner is the point, not a leak: finding the person is the
                        JOB this strip exists for, and the name is where the chase starts. */}
                    {r.owner ? (
                      <span className="text-sm text-muted">
                        Owner: <strong>{r.owner.name}</strong>
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-danger">
                        No owner — the chase is to get one named
                      </span>
                    )}
                    <div className="ml-auto">
                      <ChaseLog requestId={o.id} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <SectionTitle note="Sorted by urgency, then by how close the target is.">Working queue <NewBadge /></SectionTitle>
        </div>
        {working.length === 0 && <p className="text-subtle text-sm">Nothing open.</p>}
        {working.map(r => {
          const shown = listProjection(actor, r);
          return (
          <Card key={r.id} stripe={r.urgency} className="p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <ChannelChip channel={r.channel} />
              <CategoryChip category={r.category} />
              {r.isSwitchboard && <Chip tone="ink">Message passed on</Chip>}
              {r.isSafeguarding && <Chip tone="deepred">Safeguarding</Chip>}
              {r.cluster && (
                <Chip tone={r.cluster.isCoordinated ? 'deepred' : 'rust'}>
                  {r.cluster.isCoordinated ? 'Coordinated group' : 'Part of a burst'}
                </Chip>
              )}
              <Link href={`/r/${r.ref}`} className={`font-semibold text-base hover:underline flex-1 min-w-[240px] ${shown.masked ? 'italic text-subtle' : ''}`}>
                {shown.subject || <span className="italic text-subtle">(no subject)</span>}
              </Link>
              <AckBadge req={r} now={now} />
              <SlaBadge dueAt={r.slaDueAt} firstReplyAt={r.firstReplyAt} now={now} />
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <Quiet>{r.campus.code.toUpperCase()} · {senderIdentityLabel(shown, r.family, r.senderEmail, 'unknown')} · {r.ref}</Quiet>
              <AddressTag address={senderAddressLabel(shown, r.senderEmail)} />
              {r.owner
                ? <span className="text-sm text-muted">Owner: <strong>{r.owner.name}</strong></span>
                : <span className="text-sm font-semibold text-danger">No owner</span>}
            </div>
          </Card>
          );
        })}
      </section>

      {noise.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle note="Kept on record, deliberately out of the working queue.">
            Filtered out <NewBadge />
          </SectionTitle>
          <div className="flex flex-col gap-1.5">
            {noise.map(r => (
              <div key={r.id} className="flex items-center gap-3 flex-wrap text-sm text-subtle bg-surface/60 rounded-md px-3 py-2">
                <span className="line-through">{r.subject}</span>
                {/* The address is the judgment this strip asks the reader to double-check —
                    "vendor, not a known family" is only auditable with the address in view. */}
                <AddressTag address={r.senderEmail} />
                <span className="text-xs">— {r.suggestionReason}</span>
                <Link href={`/r/${r.ref}`} className="ml-auto text-xs underline hover:text-foreground">view</Link>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
