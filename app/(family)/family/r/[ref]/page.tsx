import Link from 'next/link';
import { db } from '@/lib/db';
import { currentFamily } from '@/lib/family-session';
import { parentStatusLabel } from '@/core/app-rail';
import { FamilyThreadActions } from '@/components/FamilyThreadActions';

export const dynamic = 'force-dynamic';

const fmt = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(d);

/**
 * SD-COM-2: threads belong to a ROLE/OFFICE, not a person. The staff face stores the real
 * sender label on every outbound message — the audit must answer "who wrote this" — but this
 * face maps ALL of them to the office label at render time. A person's name here would turn
 * the desk into a personal channel that breaks the moment that person is on leave; the office
 * name is the continuity the desk exists to provide. The record itself is untouched.
 */
const OUTBOUND_LABEL = 'Front Office';

// Matches the tone mapping on the requests list — a quiet cue for whose move it is.
const STATUS_TONE: Record<string, string> = {
  'With the school': 'fh-badge--info',
  'We’ve replied — over to you': 'fh-badge--warning',
  Resolved: 'fh-badge--success',
};

export default async function FamilyThread({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const family = await currentFamily();

  const r = await db.request.findUnique({
    where: { ref },
    include: { messages: { orderBy: { at: 'asc' } } },
  });

  // R3-14 on the READ: the URL is never an access boundary. A reference that reaches this
  // family by forwarding, a screenshot or a guess opens nothing — knowing a reference is not
  // permission to read it, or even to learn whether it exists: "not found" and "not yours"
  // are ONE refusal, exactly as the server actions merge them. The refusal is calm and
  // names no one.
  if (!r || r.familyId !== family.id) {
    return (
      <div className="max-w-[60ch]">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Not one of your requests</h1>
        <p className="text-sm text-muted mt-3">
          The reference {ref} isn&rsquo;t on your family&rsquo;s account, so there is nothing to
          show here. If you think it should be, please contact the school office.
        </p>
        <Link href="/family" className="inline-block mt-4 text-primary underline">
          Back to my requests
        </Link>
      </div>
    );
  }

  const status = parentStatusLabel(r.status);

  /* What is deliberately ABSENT from this face (QM-D34(1)): the trail, internal notes, the
     classifier's suggestion and its reason, owner and staff names, cluster membership,
     safeguarding and urgency chips. The queue item is the staff face; this face is the
     conversation and where it stands — nothing else. */
  return (
    <div className="flex flex-col gap-6">
      <Link href="/family" className="text-sm text-primary hover:underline">
        ← my requests
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight leading-tight">
          {r.subject || <span className="italic text-subtle">(no subject)</span>}
        </h1>
        <div className="flex items-center gap-3 flex-wrap mt-2 text-sm text-muted">
          <span className={`fh-badge ${STATUS_TONE[status] ?? ''}`}>{status}</span>
          <span>raised {fmt(r.arrivedAt)}</span>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        {r.messages.map(m => (
          <div
            key={m.id}
            className={`rounded-lg p-4 ${m.direction === 'in' ? 'fh-card' : 'bg-primary-subtle'}`}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold">
                {m.direction === 'in' ? 'You' : OUTBOUND_LABEL}
              </span>
              <span className="text-xs text-subtle ml-auto">{fmt(m.at)}</span>
            </div>
            <p className="text-sm text-muted mt-2 whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </section>

      <FamilyThreadActions requestId={r.id} status={r.status} satisfaction={r.satisfaction} />
    </div>
  );
}
