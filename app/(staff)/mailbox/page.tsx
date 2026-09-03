import Link from 'next/link';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { can, listProjection } from '@/core/permissions';
import { readMailboxHealth } from '@/lib/ingest/health';
import { formatInstantIST, formatInstantShortIST } from '@/core/dates';
import { gmailThreadUrl, ledgerOutcomeLabel, ledgerOutcomeTone } from '@/core/mailLedger';
import { senderAddressLabel, senderIdentityLabel, statusLabel } from '@/core/labels';
import { AddressTag, Card, Chip, NewBadge, Quiet, SectionTitle } from '@/components/bits';
import { SyncPanel } from '@/components/SyncPanel';

export const dynamic = 'force-dynamic';

// /mailbox — the mailbox's one home (2026-08-24, the email-visibility round). Everything
// about the PIPE lives here: is it alive, how fresh, who last pulled, what each pass did.
// The queue carries a one-line strip linking here; what became of each MESSAGE is the mail
// ledger's job (step 3 of this round). Shape follows recruitment's /mail + MailboxHealthCard,
// the estate reference for exactly this trust question.

const TRIGGER_LABEL: Record<string, string> = { pull: 'Pull', tick: 'Timer' };

export default async function MailboxPage() {
  const actor = await currentActor();
  // Same audience as the queue: seeing pipe health rides the same capability as seeing the
  // queue it feeds. (view_queue is held by every staff role, including oversight.)
  const gate = can(actor, 'view_queue');
  if (!gate.allowed) {
    return (
      <div className="max-w-[70ch]">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Out of scope</h1>
        <p className="text-base text-muted mt-3">{gate.reason}</p>
      </div>
    );
  }

  const campusIds = await visibleCampusIds(actor);
  const [health, runs, entries, entryCount] = await Promise.all([
    readMailboxHealth(),
    db.ingestRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { actor: { select: { name: true } } },
    }),
    // The ledger, scoped exactly like the queue: a row whose request sits outside the
    // viewer's campuses is absent, and QM-D33's suppression holds here too — a complaint
    // about the viewer must not leak through the mailbox's side door. Rows with NO request
    // (processing errors) have no campus and no audience question; every queue viewer sees
    // them, because an unprocessed mail is precisely what someone must go look at.
    db.mailLedgerEntry.findMany({
      where: {
        OR: [
          { requestId: null },
          { request: { campusOrgUnitId: { in: campusIds }, NOT: { aboutStaffIds: { has: actor.id } } } },
        ],
      },
      orderBy: { processedAt: 'desc' },
      take: 50,
      include: { request: { include: { family: true } } },
    }),
    db.mailLedgerEntry.count({
      where: {
        OR: [
          { requestId: null },
          { request: { campusOrgUnitId: { in: campusIds }, NOT: { aboutStaffIds: { has: actor.id } } } },
        ],
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-[1000px]">
      <div>
        <Quiet>The pipe, not the mail</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">
          Mailbox <NewBadge />
        </h1>
        <p className="text-sm text-muted mt-2 max-w-[72ch]">
          Whether the desk mailbox is being read, how fresh this system is, what every pass did —
          and, in the ledger below, every mail the mailbox has processed and what became of it.
        </p>
      </div>

      <Card stripe={health.tone === 'danger' ? 'critical' : health.tone === 'warning' ? 'high' : 'normal'} className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`fh-badge fh-badge--${health.tone}`}>{health.label}</span>
          <span className="text-sm text-foreground flex-1 min-w-[280px]">{health.sentence}</span>
        </div>
        <p className="text-xs text-subtle mt-2">{health.dedupeAssurance}</p>
      </Card>

      <SyncPanel
        sourceName={health.sourceName}
        ready={health.sourceReady}
        readyReason={health.sourceReadyReason}
      />

      <section className="flex flex-col gap-3">
        <SectionTitle note="Every pass, button or timer — nothing the pipe does is off the record.">
          Recent passes
        </SectionTitle>
        <p className="text-sm text-muted max-w-[76ch]">
          One row per pass. <strong>Became requests</strong> can be larger than{' '}
          <strong>mails read</strong> — a single missed-call report lists many calls, and each
          call becomes its own request. That is the report doing its job, not double-counting.
        </p>
        {runs.length === 0 ? (
          <p className="text-subtle text-sm">
            No pass recorded yet. Pressing Pull above will write the first row — and once the
            timer is live, a row lands here every five minutes whether anyone is watching or not.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fh-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">When</th>
                  <th className="text-left">Run by</th>
                  <th className="text-left">Outcome</th>
                  {/* Feedback #17: three people spent a minute on this table wondering why
                      "new" exceeded "fetched". The answer was already on the page — below the
                      table, in small grey text, which is not where the question gets asked.
                      The columns now say what they mean, and the row that prompts the question
                      answers it where it stands. */}
                  <th className="text-right" title="How many emails this pass read from the mailbox.">
                    Mails read
                  </th>
                  <th className="text-right" title="Requests created. Can exceed mails read: one missed-call report lists many calls and becomes one request per call.">
                    Became requests
                  </th>
                  <th className="text-right" title="Replies that joined a request already open, instead of opening a duplicate.">
                    Joined existing
                  </th>
                  <th className="text-right" title="Automated and vendor mail set aside without a person touching it. Parked, not deleted — still searchable.">
                    Parked
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums">{formatInstantShortIST(r.startedAt)}</td>
                    <td className="whitespace-nowrap">
                      {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                      {r.actor ? ` — ${r.actor.name}` : ''}
                    </td>
                    <td>
                      {r.ok ? (
                        <span className="fh-badge fh-badge--success">Completed</span>
                      ) : r.finishedAt ? (
                        <span className="fh-badge fh-badge--danger" title={r.errors[0] ?? undefined}>Failed</span>
                      ) : (
                        <span className="fh-badge fh-badge--warning" title="The pass never wrote a finish — a deploy or crash cut it short.">Died mid-flight</span>
                      )}
                      {r.ok && r.errors.length > 0 && (
                        <span className="text-xs text-danger ml-2" title={r.errors[0]}>
                          {r.errors.length} message{r.errors.length === 1 ? '' : 's'} failed
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{r.fetched}</td>
                    <td className="text-right tabular-nums">
                      {r.created}
                      {r.created > r.fetched && (
                        <span
                          className="ml-1 text-xs text-subtle"
                          title={`${r.fetched} mails became ${r.created} requests because a missed-call report lists many calls and each one becomes its own request.`}
                        >
                          ?
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{r.appended}</td>
                    <td className="text-right tabular-nums">{r.parked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle note="Every mail the mailbox has processed, newest first, and what became of it.">
          The ledger <NewBadge />
        </SectionTitle>
        {entries.length === 0 ? (
          <p className="text-subtle text-sm">
            No mail on the ledger yet. It fills as mail is processed — and the history that was
            ingested before the ledger existed has been carried in from the requests themselves.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fh-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Received</th>
                  <th className="text-left">From</th>
                  <th className="text-left">Subject</th>
                  <th className="text-left">What became of it</th>
                  <th className="text-left"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  // Masking rides the linked request, exactly as on the queue: a Tier-2 row
                  // hides subject, identity AND address here too. A row with no request has
                  // nothing classified to hide.
                  const shown = e.request
                    ? listProjection(actor, e.request)
                    : { subject: e.subject, preview: '', masked: false };
                  const gmail = gmailThreadUrl(e.source, e.threadId);
                  return (
                    <tr key={e.id}>
                      {/* Full form WITH the year: the ledger spans years (the first live pull
                          swept in old account mail), and "11-May" reading as this year was a
                          real confusion in the 24-Aug production review. */}
                      <td className="whitespace-nowrap tabular-nums align-top">
                        {formatInstantIST(e.receivedAt)}
                      </td>
                      <td className="align-top">
                        <div className="font-medium">
                          {senderIdentityLabel(shown, e.request?.family ?? null, e.fromEmail, e.fromName ?? '—')}
                        </div>
                        <AddressTag address={senderAddressLabel(shown, e.fromEmail)} />
                      </td>
                      <td className="align-top">
                        <div className={shown.masked ? 'italic text-subtle' : ''}>
                          {shown.subject || <span className="italic text-subtle">(no subject)</span>}
                        </div>
                        {e.detail && !shown.masked && (
                          <div className="text-xs text-subtle mt-0.5">{e.detail}</div>
                        )}
                      </td>
                      <td className="align-top">
                        <Chip tone={
                          { success: 'green', warning: 'amber', danger: 'deepred', outline: 'ink' }[ledgerOutcomeTone(e.outcome)]
                        }>
                          {ledgerOutcomeLabel(e.outcome)}
                        </Chip>
                        {e.request && (
                          <div className="text-xs text-subtle mt-1">
                            {e.request.ref} · {statusLabel(e.request.status)}
                          </div>
                        )}
                      </td>
                      <td className="align-top whitespace-nowrap">
                        {e.request && (
                          <Link className="text-xs text-primary underline mr-3" href={`/r/${e.request.ref}`}>
                            Open request
                          </Link>
                        )}
                        {gmail && (
                          <a className="text-xs text-primary underline" href={gmail} target="_blank" rel="noopener noreferrer">
                            Open in Gmail
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {entryCount > entries.length && (
          <p className="text-xs text-subtle">
            Showing the newest {entries.length} of {entryCount} mails on the ledger — older ones
            are still recorded, and always in the mailbox itself.
          </p>
        )}
      </section>
    </div>
  );
}
