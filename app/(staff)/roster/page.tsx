import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { can } from '@/core/permissions';
import { Card, Chip, NewBadge, Quiet, SectionTitle } from '@/components/bits';
import { CATEGORIES } from '@/core/taxonomy';
import { istDayStart } from '@/lib/assignment';
import { RosterAdmin } from '@/components/RosterAdmin';

// Feedback #21 (roster), #18 (routing) and the away half of #20, on one page — because they
// are one question: who is covering the desk, and who gets what.

export const dynamic = 'force-dynamic';

const DAYS_SHOWN = 14;

export default async function Roster() {
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);
  const now = new Date();
  const start = istDayStart(now);

  // One campus at a time: a roster spanning campuses is not a thing anyone reads. Group-scoped
  // people see their first campus and can switch with the existing campus picker.
  const campusId = campusIds[0] ?? 'fsk';
  const mayEdit = can(actor, 'assign', { campusOrgUnitId: campusId }).allowed;

  const [campus, staff, roster, routes] = await Promise.all([
    db.orgUnit.findUnique({ where: { id: campusId } }),
    db.staff.findMany({
      where: {
        OR: [{ scopeOrgUnitId: campusId }, { scopeOrgUnitId: 'group' }],
        permissions: { has: 'resolve' },
      },
      orderBy: { name: 'asc' },
    }),
    db.rosterDay.findMany({
      where: {
        campusOrgUnitId: campusId,
        onDate: { gte: start, lt: new Date(start.getTime() + DAYS_SHOWN * 86400000) },
      },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { onDate: 'asc' },
    }),
    db.categoryRoute.findMany({
      where: { campusOrgUnitId: campusId },
      include: { staff: { select: { id: true, name: true } } },
    }),
  ]);

  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => {
    const date = new Date(start.getTime() + i * 86400000);
    return {
      iso: date.toISOString(),
      onDuty: roster.filter(r => r.onDate.getTime() === date.getTime())
        .map(r => ({ id: r.staff.id, name: r.staff.name })),
    };
  });

  const away = staff.filter(s => s.awayUntil && s.awayUntil.getTime() > now.getTime());

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Quiet>{campus?.name ?? campusId}</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">
          Who is on the desk <NewBadge />
        </h1>
        <p className="mt-2 text-sm text-muted max-w-[74ch]">
          The roster decides who is available each day; the routing below decides who gets what
          among them. A request goes to its usual owner when they are on, and to whoever is on
          when they are not — cover beats expertise, because an owner who is present beats the
          right owner who is away.
        </p>
      </div>

      {away.length > 0 && (
        <Card stripe="high" className="p-4">
          <Quiet>Away right now</Quiet>
          <div className="mt-2 flex flex-wrap gap-2">
            {away.map(s => (
              <Chip key={s.id} tone="warn">
                {s.name} — back {s.awayUntil!.toISOString().slice(0, 10)}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            Their unanswered work returns to the claimable pool automatically rather than
            waiting for someone to notice.
          </p>
        </Card>
      )}

      {!mayEdit && (
        <Card stripe="normal" className="p-4">
          <p className="text-sm">
            You can see the roster but not change it — that needs the <code>assign</code>
            {' '}capability at this campus.
          </p>
        </Card>
      )}

      <RosterAdmin
        campusOrgUnitId={campusId}
        canEdit={mayEdit}
        staff={staff.map(s => ({
          id: s.id, name: s.name, roleLabel: s.roleLabel,
          awayUntil: s.awayUntil ? s.awayUntil.toISOString().slice(0, 10) : null,
        }))}
        days={days}
        categories={CATEGORIES.map(c => ({ key: c.key, label: c.label }))}
        routes={Object.fromEntries(routes.map(r => [r.category, r.staff.id]))}
      />

      <section className="flex flex-col gap-3">
        <SectionTitle note="What happens when nobody acts.">If work sits</SectionTitle>
        <Card stripe="normal" className="p-4 text-sm flex flex-col gap-2">
          <p>
            A request that has an owner but no reply to the family goes back to the claimable
            pool when its owner is marked away, or when it has sat untouched past the limit for
            its urgency: <strong>2 hours</strong> for critical, <strong>4</strong> for high,
            {' '}<strong>24</strong> for normal, <strong>48</strong> for low.
          </p>
          <p className="text-muted">
            It returns to the POOL rather than to a named person. Handing it to someone specific
            who may also be away just moves the problem; the pool is visible to everyone who
            could pick it up.
          </p>
        </Card>
      </section>
    </div>
  );
}
