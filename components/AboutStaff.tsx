'use client';

import { useState, useTransition } from 'react';
import { markAboutStaff, recordConveyed } from '@/app/actions';
import { Card, NewBadge, Quiet } from '@/components/bits';

type Person = { id: string; name: string; roleLabel: string };

/**
 * The complaint-about-staff panel (QM-D32/D33). Naming a person here excludes them from the
 * record's audience entirely — rule 0 in core/permissions.ts closes the record to them, the
 * queue suppresses the row, and assignment refuses them as owner. The substance reaches them
 * through the conversation recorded below (Activity kind 'conveyed'), never through the record.
 *
 * The server re-checks everything this UI offers; errors surface verbatim because every
 * refusal is written to be read (the self-marking refusal especially — it is a lockout
 * prevention, not a disclosure rule, and the message says so).
 */
export function AboutStaff({
  requestId,
  aboutStaff,
  directory,
}: {
  requestId: string;
  /** The staff this complaint is about, resolved to people. */
  aboutStaff: Person[];
  /** The full staff directory; the add-select filters out those already named. */
  directory: Person[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [withId, setWithId] = useState('');
  const [note, setNote] = useState('');

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try { await fn(); } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    });

  const named = new Set(aboutStaff.map(p => p.id));
  const addable = directory.filter(p => !named.has(p.id));

  const addSelect = (
    <select
      value=""
      disabled={pending}
      onChange={e => {
        const id = e.target.value;
        if (id) run(async () => { await markAboutStaff(requestId, id); });
      }}
      className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground max-w-[300px]"
    >
      <option value="">— name a member of staff —</option>
      {addable.map(p => <option key={p.id} value={p.id}>{p.name} · {p.roleLabel}</option>)}
    </select>
  );

  // Nobody named yet: one quiet line, not a panel — most records never need this.
  if (aboutStaff.length === 0) {
    return (
      <div className="flex items-center gap-3 flex-wrap rounded-md bg-surface-sunken px-4 py-2.5">
        <span className="text-sm text-muted">
          Concerns a member of staff? Name them — they leave the audience, the record stays.
        </span>
        {addSelect}
        {error && <span className="text-sm text-danger basis-full">{error}</span>}
      </div>
    );
  }

  return (
    <Card stripe="high" className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-heading text-lg font-bold tracking-tight">Concerns a member of staff</h3>
        <NewBadge />
      </div>
      <p className="text-sm text-muted">
        The people named here are excluded from this record&rsquo;s audience — what they need to
        hear from it reaches them through a conversation recorded below, never through the
        record itself (QM-D33).
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {aboutStaff.map(p => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-sm"
          >
            {p.name} <Quiet>{p.roleLabel}</Quiet>
            <button
              type="button"
              disabled={pending}
              title={`No longer mark this complaint as concerning ${p.name}`}
              onClick={() => run(async () => { await markAboutStaff(requestId, p.id, true); })}
              className="text-subtle hover:text-danger disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {addable.length > 0 && addSelect}
      </div>

      <div className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3">
        <Quiet>Record a conversation with a named person</Quiet>
        <div className="flex flex-wrap items-start gap-2">
          <select
            value={withId}
            disabled={pending}
            onChange={e => setWithId(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">— spoke with —</option>
            {aboutStaff.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <textarea
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="What was conveyed — this is the only route the substance takes to them."
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground flex-1 min-w-[240px] resize-y"
          />
          <button
            type="button"
            disabled={pending || !withId || !note.trim()}
            onClick={() => run(async () => {
              await recordConveyed(requestId, withId, note);
              setWithId(''); setNote('');
            })}
            className="fh-btn fh-btn--primary fh-btn--sm"
          >
            Record it
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-danger-subtle border border-danger/30 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
