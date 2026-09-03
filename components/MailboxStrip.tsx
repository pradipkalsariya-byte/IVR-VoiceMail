import Link from 'next/link';
import { readMailboxHealth } from '@/lib/ingest/health';
import { NewBadge } from '@/components/bits';

/**
 * The queue's one-line mailbox status (2026-08-24, the email-visibility round). A server
 * component reading the SAME health model as the Mailbox page, so the strip can never tell a
 * different story from the card. Placement is the point: the old mail-source panel sat below
 * the fold at the very bottom of the longest page in the app, which is how "is the mailbox
 * even being read?" became unanswerable in review. Detail stays on /mailbox — this line only
 * answers "alive? fresh? who last pulled?" and links there.
 */
export async function MailboxStrip() {
  const h = await readMailboxHealth();
  return (
    <Link
      href="/mailbox"
      className="fh-card flex items-center gap-3 flex-wrap px-3 py-2 no-underline hover:bg-surface-sunken transition-colors"
    >
      <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Mailbox</span>
      <span className={`fh-badge fh-badge--${h.tone}`}>{h.label}</span>
      <span className="text-sm text-muted flex-1 min-w-[220px] truncate" title={h.sentence}>
        {h.lastRun
          ? `Last pass ${h.lastRun.at}${h.lastRun.byName ? ` by ${h.lastRun.byName}` : ' (timer)'} — fetched ${h.lastRun.fetched} · new ${h.lastRun.created}`
          : 'No pass recorded yet.'}
      </span>
      <NewBadge />
      <span className="text-sm text-primary underline">Open →</span>
    </Link>
  );
}
