'use client';

import { useState, useTransition } from 'react';
import { familyReply, rateResolved } from '@/app/family-actions';

/**
 * The parent's actions on their own thread: reply while it is live, rate once it resolves.
 *
 * The rating ask appears on any RESOLVED request whose satisfaction is still null — including
 * one the desk closed under a coded absence reason (QM-D18). A late rating still fills the
 * null: the figure improves whenever the family actually speaks, however late, while the
 * absence reason stays behind as the closure-time record. History is not rewritten.
 */
export function FamilyThreadActions({
  requestId,
  status,
  satisfaction,
}: {
  requestId: string;
  status: string;
  satisfaction: number | null;
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    });

  if (status === 'resolved') {
    return (
      <section className="fh-card p-5 flex flex-col gap-3">
        {satisfaction != null ? (
          <p className="text-sm text-muted">
            You rated this {satisfaction}/5 — thank you.
          </p>
        ) : (
          <>
            <p className="text-sm">
              This request is resolved. How did we do?
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted">Poor</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  disabled={pending}
                  onClick={() => run(async () => { await rateResolved(requestId, n); })}
                  className={`fh-btn fh-btn--sm fh-btn--icon ${n === satisfaction ? 'fh-btn--primary' : 'fh-btn--outline'}`}
                >
                  {n}
                </button>
              ))}
              <span className="text-xs text-muted">Great</span>
            </div>
          </>
        )}
        {error && (
          <p className="rounded-md bg-danger-subtle border border-border px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </section>
    );
  }

  // A parked record ('not_a_request') surfaces in no staff list, so a reply box here would
  // collect messages nobody will ever see — the server action refuses too, but the box must
  // not invite what the action refuses. Point at a fresh request instead.
  if (status === 'not_a_request') {
    return (
      <section className="fh-card p-5">
        <p className="text-sm text-muted">
          This record was closed without action, so nobody is watching it any more. If
          something is still wrong — or new — raise a fresh request from My requests; it will
          get its own clock and a person.
        </p>
      </section>
    );
  }

  return (
    <section className="fh-card p-5 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
          Write back
        </span>
        <textarea
          rows={3}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Add anything — a reply here goes straight onto the same conversation."
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground resize-y"
        />
      </label>
      <div>
        <button
          type="button"
          disabled={pending || !draft.trim()}
          onClick={() => run(async () => { await familyReply(requestId, draft); setDraft(''); })}
          className="fh-btn fh-btn--primary fh-btn--sm"
        >
          Send
        </button>
      </div>
      {error && (
        <p className="rounded-md bg-danger-subtle border border-border px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
