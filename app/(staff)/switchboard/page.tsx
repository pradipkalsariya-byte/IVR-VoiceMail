import Link from 'next/link';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { Card, Chip, NewBadge, Quiet, SectionTitle } from '@/components/bits';
import { BlockCaller } from '@/components/BlockCaller';
import { formatInstantShortIST } from '@/core/dates';
import { groupCallers, callerDisplayName, type CallerSlip } from '@/core/switchboard';

// The switchboard stream — feedback #8, from the 26-Aug-2026 team review:
// "the call log needs to be removed [from the queue], and what to do with the call log will be
// addressed separately." VK settled the separate part in triage: their own page.
//
// Why this is not just the queue with a filter: a missed-call slip is not a request. It has no
// subject-matter yet — the body literally says "call back, then file what it was actually
// about" — so it cannot be triaged, only rung back. It is worked as a BATCH by whoever is doing
// callbacks, which is a different job from working the queue, done at a different time.
//
// The page groups by caller rather than listing slips, because the raw list is mostly the same
// people trying repeatedly: on 26-Aug it was 414 slips from 142 numbers. Grouping turns "414
// things to do" into "142 people to ring", which is the honest number.

export const dynamic = 'force-dynamic';

export default async function Switchboard() {
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);
  const now = new Date();

  const [campuses, rows] = await Promise.all([
    db.orgUnit.findMany({ where: { id: { in: campusIds } }, orderBy: { code: 'asc' } }),
    db.request.findMany({
      where: {
        campusOrgUnitId: { in: campusIds },
        isSwitchboard: true,
        NOT: { aboutStaffIds: { has: actor.id } },
        status: { not: 'resolved' },
      },
      include: { family: true, campus: true },
      orderBy: { arrivedAt: 'desc' },
      take: 1500,
    }),
  ]);

  const slips: CallerSlip[] = rows.map(r => ({
    id: r.id,
    ref: r.ref,
    subject: r.subject,
    arrivedAt: r.arrivedAt,
    campusCode: r.campus.code,
    familyLabel: r.family?.label ?? null,
  }));

  const callers = groupCallers(slips);
  const unnamed = callers.filter(c => !c.familyLabel).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Quiet>
          {actor.scopeOrgUnitId === 'group'
            ? `All campuses · ${campuses.length}`
            : campuses[0]?.name}
        </Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">
          Switchboard <NewBadge />
        </h1>
        <p className="mt-2 text-sm text-muted max-w-[70ch]">
          Calls that rang unanswered. Nobody knows yet what any of these are about — ring back,
          then file what it turns out to be. These are deliberately kept out of the working
          queue: a callback slip is not a request until someone has spoken to the caller.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
          <span>
            <strong className="font-semibold tabular-nums text-foreground">{callers.length}</strong>{' '}
            {callers.length === 1 ? 'person' : 'people'} to ring back
          </span>
          <span>
            <strong className="font-semibold tabular-nums text-foreground">{slips.length}</strong>{' '}
            call{slips.length === 1 ? '' : 's'} in total
          </span>
        </div>
      </div>

      {/* The named/unnamed split is the honest state of the roster, not a defect to hide.
          Caller matching works the moment a number is on file — see core/switchboard.ts. */}
      {unnamed > 0 && (
        <Card stripe="normal" className="p-4">
          <div className="text-sm">
            <strong className="font-semibold">{unnamed}</strong> of these numbers are not on file,
            so the desk cannot see who is calling before it rings back.
          </div>
          <p className="mt-1 text-sm text-muted leading-snug">
            Matching a caller to a family is automatic once their number exists in the roster.
            Guardian phone numbers are currently loaded for FWGS only, which is why FSK callers
            show as a number. Importing the FSK numbers turns every one of these into a name,
            with no code change.
          </p>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <SectionTitle note="Most recent call first. Repeat callers are one row, not many.">
          Who called
        </SectionTitle>

        {callers.length === 0 && (
          <p className="text-subtle text-sm">
            Nobody is waiting for a call back. That is a good state, not an empty screen.
          </p>
        )}

        {callers.map(c => (
          <Card key={c.key} stripe="normal" className="p-4">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-semibold">{callerDisplayName(c)}</span>
                {c.familyLabel && <Chip tone="ink">on file</Chip>}
                {c.calls.length > 1 && (
                  <Chip tone="warn">
                    rang {c.calls.length} times
                  </Chip>
                )}
              </div>
              <Quiet>
                {c.campusCode} · last call {formatInstantShortIST(c.lastAt)}
              </Quiet>
            </div>

            {/* Only offered where the number is NOT a known family. Blocking somebody the
                roster recognises is almost certainly a mistake, and a control that is absent
                is a better guard than one that asks "are you sure". */}
            {c.phone && !c.familyLabel && (
              <div className="mt-2">
                <BlockCaller phone={c.phone} calls={c.calls.length} />
                <NewBadge />
              </div>
            )}

            {/* Every individual slip stays reachable — nothing here is a summary that loses
                the underlying record. */}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {c.calls.slice(0, 8).map(call => (
                <Link
                  key={call.id}
                  href={`/r/${call.ref}`}
                  className="text-primary underline hover:no-underline tabular-nums"
                >
                  {formatInstantShortIST(call.arrivedAt)}
                </Link>
              ))}
              {c.calls.length > 8 && (
                <Quiet>+{c.calls.length - 8} more</Quiet>
              )}
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
