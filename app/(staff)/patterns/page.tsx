import Link from 'next/link';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { staffDirectory } from '@/lib/staff';
import { can, listProjection } from '@/core/permissions';
import { AddressTag, Card, Chip, Quiet, SectionTitle, CategoryChip } from '@/components/bits';
import { ClusterActions } from '@/components/ClusterActions';
import { statusLabel, senderAddressLabel, senderIdentityLabel } from '@/core/labels';

export const dynamic = 'force-dynamic';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(d);

export default async function Patterns() {
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);

  const allClusters = await db.cluster.findMany({
    where: { OR: [{ campusOrgUnitId: { in: campusIds } }, { campusOrgUnitId: null }] },
    include: {
      requests: {
        include: { family: true, campus: true, owner: true },
        orderBy: { arrivedAt: 'asc' },
      },
    },
    orderBy: { windowStart: 'desc' },
  });

  // Audience exclusion (QM-D33), whole-cluster: a cluster exists because its members SHARE
  // wording, so the label and every sibling subject tell the same story as the suppressed
  // row would — hiding one member while showing "13 messages: <that same subject>" hides
  // nothing. If any member concerns the viewer, the whole cluster leaves their sight; and
  // guardCluster refuses them the bulk actions on it for the same reason.
  const clusters = allClusters.filter(
    c => !c.requests.some(r => r.aboutStaffIds.includes(actor.id)),
  );

  const coordinated = clusters.filter(c => c.isCoordinated);
  const bursts = clusters.filter(c => !c.isCoordinated);

  // Cluster actions sit behind the 'assign' capability (Staff.permissions, 2026-08-07 ruling)
  // — everyone in scope may SEE a pattern; acting on many records at once is a grant.
  // Checked through can() so 'oversight' implies it (QM-D9/D26), same as single-request assign.
  const canAct = can(actor, 'assign').allowed;
  const staff = canAct ? await staffDirectory() : [];
  const staffOptions = staff.map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }));
  const memberProps = (rs: Array<{ id: string; ref: string; status: string; ownerId: string | null }>) =>
    rs.map(r => ({ id: r.id, ref: r.ref, status: r.status, ownerId: r.ownerId }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Quiet>One event, or many?</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">Patterns</h1>
        <p className="text-base text-muted mt-2 max-w-[68ch]">
          On 7 July 2026 thirteen conversations began in one morning about one decision, and the
          school answered each individually. Four carried an identical subject and two had pasted
          a{' '}<code className="bg-surface-sunken px-1 rounded">Subject:</code>{' '}line — the signature of
          a circulated template. This screen exists so that never goes unnoticed again.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <SectionTitle note="Evidence says these were organised, not coincidental.">
          Looks coordinated
        </SectionTitle>
        {coordinated.length === 0 && (
          <p className="text-subtle text-sm">Nothing currently looks coordinated.</p>
        )}
        {coordinated.map(c => (
          <Card key={c.id} stripe="critical" className="p-5">
            <div className="flex items-start gap-3 flex-wrap">
              <Chip tone="deepred">{c.requests.length} messages · one event</Chip>
              {c.templateHits > 0 && (
                <Chip tone="rust">
                  {c.templateHits} pasted template{c.templateHits === 1 ? '' : 's'}
                </Chip>
              )}
              <div className="flex-1 min-w-[260px]">
                <div className="font-heading text-2xl font-semibold leading-tight">{c.label}</div>
                <Quiet>{fmt(c.windowStart)} → {fmt(c.windowEnd)} IST</Quiet>
              </div>
            </div>

            <div className="mt-4 rounded-md bg-surface-sunken p-3">
              <Quiet>Why this is flagged</Quiet>
              <p className="text-sm text-foreground mt-1">
                {c.templateHits > 0
                  ? `${c.requests.length} messages share an identical subject, and ${c.templateHits} ${c.templateHits === 1 ? 'contains' : 'contain'} a pasted "Subject:" line. Nobody types that into a subject box — it happens when a circulated template is copied whole.`
                  : `${c.requests.length} messages share an identical subject inside the window. Families do not independently invent the same wording.`}
              </p>
            </div>

            <div className="mt-4 rounded-md border border-danger bg-danger-subtle p-3">
              <Quiet>What to do differently</Quiet>
              {/* Honest about what this page can DO: note/assign/resolve across the cluster.
                  A bulk reply doesn't exist (yet) — the old copy promised "one message to
                  every affected family", which no button here delivers (2026-08-09 review). */}
              <p className="text-sm text-foreground mt-1">
                Handle these <strong>together</strong> — one owner, one decision on the underlying
                issue, and the same answer to every family. {c.requests.length} unconnected
                replies {c.requests.length === 1 ? 'is' : 'are'} what earns{' '}
                <em>&ldquo;typical, no lessons learnt.&rdquo;</em>
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-1.5">
              {c.requests.map(r => {
                // Same rule as the queue: a list row is the widest surface, so a safeguarding
                // subject renders masked here too unless the viewer holds the named grant.
                const shown = listProjection(actor, r);
                return (
                <div key={r.id} className="flex items-center gap-3 flex-wrap text-sm bg-surface-sunken rounded px-3 py-1.5">
                  <span className="tabular-nums text-subtle text-xs">{fmt(r.arrivedAt)}</span>
                  <Link href={`/r/${r.ref}`} className={`hover:underline flex-1 min-w-[200px] ${shown.masked ? 'italic text-subtle' : ''}`}>{shown.subject}</Link>
                  <Quiet>{r.campus.code.toUpperCase()} · {senderIdentityLabel(shown, r.family, r.senderEmail, '—')}</Quiet>
                  <AddressTag address={senderAddressLabel(shown, r.senderEmail)} />
                  <span className="text-xs text-subtle">{statusLabel(r.status)}</span>
                </div>
                );
              })}
            </div>

            {canAct && (
              <ClusterActions
                clusterId={c.id}
                clusterLabel={c.label}
                members={memberProps(c.requests)}
                staff={staffOptions}
              />
            )}
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle note="Different wording, same subject-matter, close together. Usually one decision of ours.">
          Topic bursts
        </SectionTitle>
        {bursts.length === 0 && <p className="text-subtle text-sm">No bursts detected.</p>}
        {bursts.map(c => (
          <Card key={c.id} stripe="high" className="p-5">
            <div className="flex items-start gap-3 flex-wrap">
              <Chip tone="rust">{c.requests.length} messages</Chip>
              <CategoryChip category={c.signature.replace(/^topic:/, '')} />
              <div className="flex-1 min-w-[240px]">
                <div className="font-semibold text-lg">{c.label}</div>
                <Quiet>{fmt(c.windowStart)} → {fmt(c.windowEnd)} IST</Quiet>
              </div>
            </div>
            <p className="text-sm text-muted mt-3">
              {c.requests.length} separate families raised the same subject-matter inside a day. Likely
              one decision of ours rather than {c.requests.length} unrelated problems — worth fixing at
              source, not answering {c.requests.length} times.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {c.requests.map(r => {
                const shown = listProjection(actor, r);
                return (
                <div key={r.id} className="flex items-center gap-3 flex-wrap text-sm bg-surface-sunken rounded px-3 py-1.5">
                  <span className="tabular-nums text-subtle text-xs">{fmt(r.arrivedAt)}</span>
                  <Link href={`/r/${r.ref}`} className={`hover:underline flex-1 min-w-[200px] ${shown.masked ? 'italic text-subtle' : ''}`}>{shown.subject}</Link>
                  <Quiet>{r.campus.code.toUpperCase()}</Quiet>
                </div>
                );
              })}
            </div>

            {canAct && (
              <ClusterActions
                clusterId={c.id}
                clusterLabel={c.label}
                members={memberProps(c.requests)}
                staff={staffOptions}
              />
            )}
          </Card>
        ))}
      </section>
    </div>
  );
}
