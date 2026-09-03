'use client';

import { useState, useTransition } from 'react';
import { acknowledge, assign, reply, resolve, reopen } from '@/app/actions';
import { NewBadge } from '@/components/bits';
import { SATISFACTION_ABSENT_REASONS } from '@/core/closure';

export function RequestActions({
  requestId,
  status,
  ownerId,
  staff,
  isSwitchboard,
  needsAck,
  railsNote,
}: {
  requestId: string;
  status: string;
  ownerId: string | null;
  staff: Array<{ id: string; name: string; roleLabel: string }>;
  /** Switchboard slips close without the QM-D18 satisfaction leg — see core/closure.ts. */
  isSwitchboard: boolean;
  /** Filed but nobody has marked it seen — the acknowledgement clock is still running. */
  needsAck: boolean;
  /** Where THIS reply will land — computed server-side from the same chooseRails inputs
   *  reply() uses, so the promise above the button always matches the trail below it. */
  railsNote: string;
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  // QM-D18 closure leg. '' = not chosen yet; the server refuses a close without one, so the
  // button is disabled until the choice is made rather than letting the refusal be the UX.
  const [satisfaction, setSatisfaction] = useState('');
  const [absentReason, setAbsentReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try { await fn(); } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    });

  const closureChosen = isSwitchboard || satisfaction !== '' || absentReason !== '';

  return (
    <section className="fh-card p-5 flex flex-col gap-4">
      {needsAck && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-warning-subtle border border-warning/40 px-3 py-2">
          <p className="text-sm">
            Nobody has marked this as seen — the family is still waiting for a first look, and the
            acknowledgement clock is running (QM-D12).
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => { await acknowledge(requestId); })}
            className="shrink-0 fh-btn fh-btn--primary fh-btn--sm"
          >
            I&rsquo;ve seen this
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Owner</span>
          <select
            defaultValue={ownerId ?? ''}
            disabled={pending}
            onChange={e => run(async () => { await assign(requestId, e.target.value); })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground max-w-[320px]"
          >
            <option value="">Unassigned</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.roleLabel}</option>)}
          </select>
        </label>

        <div className="ml-auto flex gap-2">
          {status === 'resolved' ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(async () => { await reopen(requestId); })}
              className="fh-btn fh-btn--outline fh-btn--sm"
            >
              Reopen
            </button>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={pending || !closureChosen}
                onClick={() => run(async () => {
                  await resolve(requestId, note, {
                    satisfaction: satisfaction === '' ? null : Number(satisfaction),
                    absentReason: absentReason === '' ? null : absentReason,
                  });
                })}
                className="fh-btn fh-btn--primary fh-btn--sm"
              >
                Mark resolved
              </button>
              {/* QM-D18: the button stays disabled rather than letting the server refusal be
                  the UX — but the reason has to be visible, not just a hover tooltip. */}
              {!closureChosen && (
                <span className="text-xs text-muted">
                  To resolve, first record the family&rsquo;s rating — or why there isn&rsquo;t one.
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {status !== 'resolved' && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
              Reply to the family
            </span>
            <textarea
              rows={4}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Write the reply here. In production this goes out as the front desk address, so the family sees no change.&#10;&#10;A blank line starts a new paragraph."
              className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground resize-y"
            />
            {/* QM-D35: the author gets NO rail choice — the engine picks per recipient, so
                this line states the outcome and offers no checkbox. And the box is not an
                email composer (QM-D35's accepted cost): no subject line, no signature —
                content only, whichever rail carries it. */}
            <span className="text-xs text-subtle">
              {railsNote} The rails are chosen per recipient — never by the author. <NewBadge />
            </span>
            {/* Added 27-Aug-2026. Email replies now leave as multipart/alternative, so a blank
                line really is a paragraph and `- ` really is a bullet in what the family
                receives. Worth SAYING: before this, every reply arrived as one unbroken wall of
                plain text, and nobody writing in this box had any reason to think otherwise. */}
            <span className="text-xs text-subtle">
              Leave a blank line between paragraphs. <code>- </code> starts a bullet,
              {' '}<code>**bold**</code> and <code>*italic*</code> work — the family sees it
              formatted, not as the symbols. <NewBadge />
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || !draft.trim()}
              onClick={() => run(async () => { await reply(requestId, draft); setDraft(''); })}
              className="fh-btn fh-btn--primary fh-btn--sm"
            >
              Send reply
            </button>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Resolution note (optional)"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground flex-1 min-w-[200px]"
            />
          </div>

          {/* QM-D18: closing needs the rating OR a coded absence reason — never both, never
              neither. A switchboard slip has no complainant to ask, so the leg disappears. */}
          {!isSwitchboard && (
            <div className="flex flex-wrap items-end gap-3 rounded-md bg-surface-sunken px-3 py-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
                  Family&rsquo;s rating
                </span>
                <select
                  value={satisfaction}
                  disabled={pending || absentReason !== ''}
                  onChange={e => setSatisfaction(e.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="">— not rated —</option>
                  {[5, 4, 3, 2, 1].map(n => (
                    <option key={n} value={n}>{n} / 5</option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-subtle pb-2">or</span>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
                  Why there isn&rsquo;t one
                </span>
                <select
                  value={absentReason}
                  disabled={pending || satisfaction !== ''}
                  onChange={e => setAbsentReason(e.target.value)}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="">— choose —</option>
                  {SATISFACTION_ABSENT_REASONS.map(r => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-subtle pb-1.5 basis-full sm:basis-auto sm:ml-auto max-w-[34ch]">
                &ldquo;Never asked&rdquo; is an honest answer — and the only one that flags our own
                process rather than the family&rsquo;s silence.
              </p>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="rounded-md bg-danger-subtle border border-danger/30 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
