import Link from 'next/link';
import { db } from '@/lib/db';
import { currentFamily } from '@/lib/family-session';
import { parentStatusLabel } from '@/core/app-rail';
import { FamilyNewRequest } from '@/components/FamilyNewRequest';

export const dynamic = 'force-dynamic';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(d);

// The tone carried by each plain-language status — a quiet cue for whose move it is, not a
// dashboard. "Over to you" is the only one that asks the parent for anything, so it is the
// only one that isn't muted.
const STATUS_TONE: Record<string, string> = {
  'With the school': 'fh-badge--info',
  'We’ve replied — over to you': 'fh-badge--warning',
  Resolved: 'fh-badge--success',
};

export default async function FamilyHome() {
  const family = await currentFamily();

  // Every request on this family's account, WHATEVER channel carried it — a parent never has
  // two places to look (QM-D34). The channel is deliberately not shown: it is desk mechanics,
  // and "you emailed us" vs "you used the app" means nothing to the person who did both.
  const rows = await db.request.findMany({
    where: { familyId: family.id },
    orderBy: { arrivedAt: 'desc' },
    select: { id: true, ref: true, subject: true, status: true, arrivedAt: true },
  });

  return (
    <div className="flex flex-col gap-10">
      {/* Frozen as the proof-of-concept face (VK, 30-Aug-2026): the Nucleus parent app is the
          family's front door now — its front-office threads file onto this same spine over the
          bridge. This screen stays for the pilot; it is not where new parent surface grows. */}
      <div className="fh-card px-4 py-3 text-sm text-muted">
        This screen is the proof-of-concept parent view. The family&rsquo;s front door is now the{' '}
        <span className="font-medium">Nucleus parent app</span> — requests raised there land on the
        same desk, with the same reference numbers.
      </div>
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight">My requests</h1>
        {rows.length === 0 && (
          <p className="text-sm text-muted">
            Nothing yet. When you raise a request below, it appears here with where it stands.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {rows.map(r => {
            const status = parentStatusLabel(r.status);
            return (
              <Link
                key={r.id}
                href={`/family/r/${r.ref}`}
                className="fh-card fh-card--interactive px-4 py-3 flex items-baseline gap-3 flex-wrap"
              >
                <span className="font-medium text-base flex-1 min-w-[240px]">
                  {r.subject || <span className="italic text-subtle">(no subject)</span>}
                </span>
                <span className={`fh-badge ${STATUS_TONE[status] ?? ''}`}>{status}</span>
                <span className="text-xs text-subtle">{fmt(r.arrivedAt)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight">Raise a request</h2>
          <p className="text-sm text-muted mt-1">
            Pick what it&rsquo;s about, say what you need, and it reaches the right desk
            directly — no forwarding, no lost mail.
          </p>
        </div>
        <FamilyNewRequest />
      </section>
    </div>
  );
}
