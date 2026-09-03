import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { staffDirectory, staffAssignableAt } from '@/lib/staff';
import { can, pendingSecondLook, secondLook } from '@/core/permissions';
import { chooseRails, canSendEmailReply, replyPromiseNote } from '@/core/app-rail';
import { pilotConfigFromEnv } from '@/core/pilot';
import { activityKindLabel, humanise, urgencyLabel, guessedSenderLabel } from '@/core/labels';
import { formatInstantIST } from '@/core/dates';
import { humanGap } from '@/core/sla';
import { gmailThreadUrlFromRequest } from '@/core/mailLedger';
import { categoryDef } from '@/core/taxonomy';
import { AddressTag, Card, ChannelChip, CategoryChip, Chip, NewBadge, Quiet, SectionTitle, SlaBadge } from '@/components/bits';
import { DraftReply } from '@/components/DraftReply';
import { BringBack } from '@/components/BringBack';
import { AboutStaff } from '@/components/AboutStaff';
import { Attachments } from '@/components/Attachments';
import { VoicemailPlayer } from '@/components/VoicemailPlayer';
import { RequestActions } from '@/components/RequestActions';
import { TriageBar } from '@/components/TriageBar';
import { TriageSecondLook } from '@/components/TriageSecondLook';
import { QueueRail } from './_QueueRail';

export const dynamic = 'force-dynamic';

// The estate DD-MMM-YYYY display rule (repo CLAUDE.md), one shared implementation.
const fmt = formatInstantIST;

export default async function RequestDetail({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);

  const r = await db.request.findUnique({
    where: { ref },
    include: {
      family: true, owner: true, campus: true, cluster: { include: { requests: true } },
      triageApprovedBy: true,
      messages: { orderBy: { at: 'asc' } },
      activities: { orderBy: { at: 'asc' }, include: { actor: true } },
      voicemailAudio: { select: { callerNumber: true, durationSeconds: true } },
    },
  });
  if (!r) notFound();

  // Feedback #12: split the exchange at the moment it was resolved. Messages that arrived
  // afterwards are still the record — a re-open must be able to read them — but they are not
  // what got the thing resolved, and mixing them in made a finished request look unfinished.
  // No resolvedAt means nothing to split: everything is "during work".
  const resolvedAtMs = r.resolvedAt?.getTime() ?? Infinity;
  const duringWork = r.messages.filter(m => m.at.getTime() <= resolvedAtMs);
  const afterResolution = r.messages.filter(m => m.at.getTime() > resolvedAtMs);

  // QM-D33, mirrored on the READ exactly as guard() mirrors it on every write: a complaint is
  // closed to the person it is about, whatever they hold. Checked FIRST, before scope, in the
  // same order can() checks its rule 0 — the scope refusal below says "switch identity to view
  // it", which is exactly the wrong invitation here (no identity opens a complaint about you).
  // Rendered through the page's existing readable-refusal idiom, because a refusal a person
  // can read is one they will respect rather than work around.
  if (r.aboutStaffIds.includes(actor.id)) {
    const audience = can(actor, 'view_queue', {
      campusOrgUnitId: r.campusOrgUnitId,
      isAboutActor: true,
    });
    return (
      <div className="max-w-[70ch]">
        <h1 className="font-heading text-2xl font-bold tracking-tight">This record is closed to you</h1>
        <p className="text-base text-muted mt-3">{audience.reason}</p>
        <Link href="/" className="inline-block mt-4 text-primary underline">Back to the queue</Link>
      </div>
    );
  }

  // Scope is enforced on the READ too — the URL is never an access boundary (R3-14).
  if (!campusIds.includes(r.campusOrgUnitId)) {
    return (
      <div className="max-w-[70ch]">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Out of scope</h1>
        <p className="text-base text-muted mt-3">
          {r.ref} belongs to a campus outside {actor.name}&rsquo;s scope. Switch identity to view it —
          knowing the reference is not the same as being allowed to read it.
        </p>
        <Link href="/" className="inline-block mt-4 text-primary underline">Back to the queue</Link>
      </div>
    );
  }

  // Safeguarding is Tier-2, NAMED access (R3-4/R3-18): being in campus scope — or even holding
  // 'oversight' — is not enough to open the record. The deny reason is shown, not hidden: a
  // refusal a person can read is a refusal they will respect rather than work around.
  if (r.isSafeguarding) {
    const view = can(actor, 'view_safeguarding', {
      campusOrgUnitId: r.campusOrgUnitId, isSafeguarding: true,
    });
    if (!view.allowed) {
      return (
        <div className="max-w-[70ch]">
          <div className="flex items-center gap-2"><Chip tone="deepred">Safeguarding · Tier 2</Chip></div>
          <h1 className="font-heading text-2xl font-bold tracking-tight mt-3">Named access only</h1>
          <p className="text-base text-muted mt-3">{view.reason}</p>
          <Link href="/" className="inline-block mt-4 text-primary underline">Back to the queue</Link>
        </div>
      );
    }
  }

  const staff = await staffDirectory();
  const now = new Date();
  const siblings = r.cluster?.requests.filter(x => x.id !== r.id) ?? [];

  // QM-D10, derived at read time (no stored pending flag — QM-D15's shape). The approve
  // affordance only appears for someone who both holds the grant and is not the filer.
  const secondLookPending = pendingSecondLook(r);
  const filerId = r.activities.find(a => a.kind === 'filed' && a.actorId)?.actorId ?? null;
  const mayApprove = secondLookPending
    && can(actor, 'triage_approve', { campusOrgUnitId: r.campusOrgUnitId, isSafeguarding: r.isSafeguarding }).allowed
    && secondLook(actor.id, filerId).allowed;

  return (
    // DS §54 split (v1.29 re-vendor, 30-Aug-2026): the live queue rides alongside the open
    // record at ≥1024px, so triage is next-click instead of back-and-forth. The rail renders
    // ONLY here — after the about-actor, campus-scope and safeguarding gates above have all
    // passed — and selection is this page's own URL, so deep links are unchanged and opening
    // a row performs no action.
    <div className="fh-split">
      <QueueRail actor={actor} campusIds={campusIds} currentRef={r.ref} />
      <div className="fh-split__detail flex flex-col gap-6 max-w-[1000px]">
      <Link href="/" className="text-sm text-primary hover:underline">← the queue</Link>

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <ChannelChip channel={r.channel} />
          <CategoryChip category={r.category} />
          {r.isSafeguarding && <Chip tone="deepred">Safeguarding · Tier 2</Chip>}
          {/* A quiet chip, never a lock (QM-D10) — the reply box below stays fully live. */}
          {secondLookPending && <TriageSecondLook requestId={r.id} mayApprove={mayApprove} />}
          {r.triageApprovedAt && r.triageApprovedBy && (
            <Quiet>Second look: {r.triageApprovedBy.name}</Quiet>
          )}
          <Quiet>{r.ref} · {r.campus.code.toUpperCase()}</Quiet>
        </div>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-2 leading-tight">
          {r.subject || <span className="italic text-subtle">(no subject)</span>}
        </h1>
        {/* This page renders only past the audience/safeguarding gates above, so the raw
            address shows unmasked here — the list-surface masking rule does not apply. */}
        <div className="flex items-center gap-4 flex-wrap mt-2 text-sm text-muted">
          <span>{r.family?.label ?? guessedSenderLabel(r.senderEmail) ?? 'Sender not identified'}</span>
          <AddressTag address={r.senderEmail} />
          <span>arrived {fmt(r.arrivedAt)}</span>
          <span>clock started {fmt(r.clockStartsAt)}</span>
          <SlaBadge dueAt={r.slaDueAt} firstReplyAt={r.firstReplyAt} now={now} />
          {/* Feedback #26 (transcript 00:29:07): "I'm hoping that when you resolve, it will
              show resolution in so much turnaround time." Measured from when the family first
              wrote, not from when the clock started — the desk-hours grace is the school's
              concession to itself, and it is not what the family experienced waiting. */}
          {r.resolvedAt && (
            <span
              className="fh-badge fh-badge--success"
              title={`From the family's first message at ${fmt(r.arrivedAt)} to resolution at ${fmt(r.resolvedAt)}.`}
            >
              Resolved in {humanGap(r.arrivedAt, r.resolvedAt)}
            </span>
          )}
          {/* Only a REAL Gmail thread id links out — the shape test keeps fabricated
              fixtures from ever growing a Gmail link (core/mailLedger.ts). */}
          {gmailThreadUrlFromRequest(r.sourceThreadId) && (
            <a
              className="text-primary underline"
              href={gmailThreadUrlFromRequest(r.sourceThreadId)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Gmail
            </a>
          )}
          <NewBadge />
        </div>
      </div>

      {r.voicemailAudio && (
        <VoicemailPlayer
          requestId={r.id}
          callerNumber={r.voicemailAudio.callerNumber}
          durationSeconds={r.voicemailAudio.durationSeconds}
        />
      )}

      {r.arrivedAt.getTime() !== r.clockStartsAt.getTime() && (
        <div className="rounded-md bg-surface-sunken px-4 py-2.5 text-sm text-muted">
          This arrived outside desk hours, so the response clock started at the next opening bell
          rather than on arrival — the desk is not marked late for a message nobody could have seen.
        </div>
      )}

      {/* One recipient is provenance ("arrived at the desk's address"); several is the
          recipient-sprawl finding and keeps its warning framing. Same card, two postures —
          a single-address mail must not wear a warning stripe for behaving correctly. */}
      {r.originalRecipients.length === 1 && (
        <Card stripe="normal" className="p-4">
          <Quiet>Arrived at</Quiet>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <code className="bg-surface-sunken rounded px-2 py-0.5 text-xs">{r.originalRecipients[0]}</code>
          </div>
        </Card>
      )}
      {r.originalRecipients.length > 1 && (
        <Card stripe="high" className="p-4">
          <Quiet>Who the family actually wrote to — {r.originalRecipients.length} addresses</Quiet>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {r.originalRecipients.map(a => (
              <code key={a} className="bg-surface-sunken rounded px-2 py-0.5 text-xs">{a}</code>
            ))}
          </div>
          <p className="text-xs text-subtle mt-2">
            Copying several addresses makes ownership <em>less</em> likely, not more. One owner below
            is the fix.
          </p>
        </Card>
      )}

      {r.cluster && siblings.length > 0 && (
        <Card stripe="critical" className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            {r.cluster.isCoordinated
              ? <Chip tone="deepred">Part of a coordinated group</Chip>
              : <Chip tone="rust">Part of a burst</Chip>}
            <span className="text-sm font-medium">{r.cluster.label}</span>
          </div>
          <p className="text-sm text-muted mt-2">
            {siblings.length} other {siblings.length === 1 ? 'family wrote' : 'families wrote'} about
            this within the same window. Handle them together — one owner, one consistent answer.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {siblings.map(s => (
              <Link key={s.id} href={`/r/${s.ref}`} className="text-xs underline text-primary">
                {s.ref}
              </Link>
            ))}
          </div>
          <Link href="/patterns" className="inline-block mt-3 text-xs text-primary underline">
            See the whole pattern →
          </Link>
        </Card>
      )}

      {r.suggestionReason && (
        <Card stripe="low" className="p-4">
          <Quiet>What the assistant suggested — and why</Quiet>
          <p className="text-sm text-foreground mt-1">
            <strong>
              {r.suggestedCategory
                ? (categoryDef(r.suggestedCategory)?.label ?? humanise(r.suggestedCategory))
                : 'Untriaged'}
            </strong>
            {' / '}
            {r.suggestedUrgency ? urgencyLabel(r.suggestedUrgency) : '—'}
            {' — '}{r.suggestionReason}
          </p>
          <p className="text-xs text-subtle mt-2">
            A suggestion only. It never files, never replies, never closes.
          </p>
        </Card>
      )}

      {r.draftReply && (
        <Card stripe="low" className="p-4">
          <div className="flex items-center gap-2">
            <Quiet>A reply you could send — nothing has been sent</Quiet>
            <NewBadge />
          </div>
          <div className="mt-2">
            <DraftReply text={r.draftReply} at={r.draftReplyAt ? fmt(r.draftReplyAt) : 'just now'} />
          </div>
        </Card>
      )}

      {/* Feedback #12 (transcript 00:10:00): "after conversation is cluttering this... that
          doesn't make sense". A resolved request keeps collecting replies — a parent says
          thank you, a colleague adds a note — and they pile below the resolution as though the
          work were still running. They are split out here rather than hidden: the exchange is
          part of the record and a re-open needs to see it, but it is no longer mixed in with
          what actually got the thing resolved. VK noted this had been raised before and was
          still outstanding. */}
      <section className="flex flex-col gap-3">
        <SectionTitle>The conversation</SectionTitle>
        {duringWork.map(m => (
          <div
            key={m.id}
            className={`rounded-lg p-4 ${m.direction === 'in' ? 'bg-surface' : 'bg-primary/[0.06] border border-primary/20'}`}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold">{m.senderLabel}</span>
              <Quiet>{m.direction === 'in' ? 'inbound' : 'our reply'}</Quiet>
              <span className="text-xs text-subtle ml-auto">{fmt(m.at)}</span>
            </div>
            <p className="text-sm text-muted mt-2 whitespace-pre-wrap">{m.body}</p>
                  <Attachments value={m.attachments} />
          </div>
        ))}

        {afterResolution.length > 0 && (
          <details className="rounded-lg border border-border bg-surface/60">
            <summary className="cursor-pointer p-3 text-sm font-medium">
              {afterResolution.length} message{afterResolution.length === 1 ? '' : 's'} after this
              was resolved
              <span className="ml-2 font-normal text-subtle">
                — kept on the record, out of the way
              </span>
            </summary>
            <div className="flex flex-col gap-3 p-3 pt-0">
              {afterResolution.map(m => (
                <div
                  key={m.id}
                  className={`rounded-lg p-4 ${m.direction === 'in' ? 'bg-surface' : 'bg-primary/[0.06] border border-primary/20'}`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold">{m.senderLabel}</span>
                    <Quiet>{m.direction === 'in' ? 'inbound' : 'our reply'}</Quiet>
                    <span className="text-xs text-subtle ml-auto">{fmt(m.at)}</span>
                  </div>
                  <p className="text-sm text-muted mt-2 whitespace-pre-wrap">{m.body}</p>
                  <Attachments value={m.attachments} />
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {r.status === 'unfiled' || r.status === 'not_a_request' ? (
        /* The 2026-08-09 review's sharpest trap: clicking into a "Needs filing" item to read
           it fully landed on a page with a live reply box and no filing control — the exact
           inversion of the queue's "only what you file enters the working queue". The record
           now offers filing where filing is the next act; reply/resolve appear once filed
           (and the actions layer refuses them regardless — core/lifecycle.ts). */
        <Card stripe={r.suggestedUrgency ?? 'normal'} className="p-4">
          <SectionTitle
            note={
              r.status === 'not_a_request'
                ? 'Parked as not a request. Filing it brings it into the working queue.'
                : 'Nothing is lost — but only what you file enters the working queue.'
            }
          >
            File it
          </SectionTitle>
          <TriageBar
            requestId={r.id}
            suggestedCategory={r.suggestedCategory}
            suggestedUrgency={r.suggestedUrgency}
            staff={staffAssignableAt(staff, r.campusOrgUnitId).map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
          />
          {r.status === 'not_a_request' && (
            <div className="mt-4 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
              <BringBack requestId={r.id} />
              <NewBadge />
            </div>
          )}
        </Card>
      ) : (
        <RequestActions
          requestId={r.id}
          status={r.status}
          ownerId={r.ownerId}
          staff={staffAssignableAt(staff, r.campusOrgUnitId).map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
          isSwitchboard={r.isSwitchboard}
          needsAck={r.ackDueAt != null && r.acknowledgedAt == null && r.status !== 'resolved'}
          railsNote={(() => {
            // The same inputs reply() feeds chooseRails/canSendEmailReply — so the promise above
            // the Send button always matches what the trail will actually record for THIS
            // recipient, pilot-mode redirect included.
            const rails = chooseRails({
              hasAppLogin: r.family != null,
              hasEmail: Boolean(r.family?.emailKey),
            });
            const pilot = pilotConfigFromEnv();
            return replyPromiseNote({
              rails,
              canSendEmail: canSendEmailReply(r, r.family?.emailKey),
              pilotReviewerEmail: pilot.enabled ? pilot.reviewerEmail : null,
            });
          })()}
        />
      )}

      {/* QM-D32/D33: naming the staff a complaint concerns. The viewer here is already past
          the audience gate above, so the panel never renders to a person it names. */}
      <AboutStaff
        requestId={r.id}
        aboutStaff={r.aboutStaffIds
          .map(id => staff.find(s => s.id === id))
          .filter((s): s is (typeof staff)[number] => Boolean(s))
          .map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
        directory={staff.map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
      />

      <section className="flex flex-col gap-2">
        <SectionTitle>The trail</SectionTitle>
        <p className="text-sm text-subtle">
          Everything after filing lands on the record, not in someone&rsquo;s inbox.
        </p>
        <div className="flex flex-col gap-1.5 mt-1">
          {r.activities.map(a => (
            <div key={a.id} className="flex gap-3 flex-wrap text-sm bg-surface rounded px-3 py-2">
              <span className="text-xs text-subtle tabular-nums whitespace-nowrap">{fmt(a.at)}</span>
              {/* A 'conveyed' leg is the QM-D33 route to the named person — labelled as what
                  it records, a conversation, not an internal kind name. */}
              {a.kind === 'conveyed'
                ? <Chip tone="plum">Conversation held</Chip>
                : <Chip tone="ink">{activityKindLabel(a.kind)}</Chip>}
              <span className="text-muted flex-1 min-w-[220px]">{a.detail}</span>
              {a.actor && <Quiet>{a.actor.name}</Quiet>}
            </div>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
