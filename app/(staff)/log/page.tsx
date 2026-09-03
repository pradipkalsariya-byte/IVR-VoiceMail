import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { staffDirectory } from '@/lib/staff';
import { QuickLog } from '@/components/QuickLog';
import { Quiet } from '@/components/bits';

export const dynamic = 'force-dynamic';

export default async function LogPage() {
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);

  const [campuses, families, staff] = await Promise.all([
    db.orgUnit.findMany({ where: { id: { in: campusIds } }, orderBy: { code: 'asc' } }),
    db.family.findMany({
      where: { campusOrgUnitId: { in: campusIds } },
      orderBy: { label: 'asc' },
      include: { phones: { select: { phoneKey: true } } },
    }),
    staffDirectory(),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-[880px]">
      <div>
        <Quiet>Calls · walk-ins · WhatsApp · via staff · at an event</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">Log a request</h1>
        <p className="text-base text-muted mt-2 max-w-[64ch]">
          The design rule: <strong>logging must be faster than not logging.</strong> Two minutes and
          it will not happen. The timer below is here to keep us honest — target is under twenty
          seconds.
        </p>
      </div>

      <QuickLog
        campuses={campuses.map(c => ({ id: c.id, code: c.code, name: c.name }))}
        families={families.map(f => ({ id: f.id, label: f.label, campusOrgUnitId: f.campusOrgUnitId, phoneKeys: f.phones.map(p => p.phoneKey) }))}
        staff={staff.map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
      />
    </div>
  );
}
