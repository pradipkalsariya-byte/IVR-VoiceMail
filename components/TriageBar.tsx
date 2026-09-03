'use client';

import { useState, useTransition } from 'react';
import { fileRequest, markNotARequest, assign } from '@/app/actions';
import { CATEGORIES, URGENCIES, categoryDef, type Urgency } from '@/core/taxonomy';
import { urgencyLabel } from '@/core/labels';

/**
 * Accept the suggestion in one click, or override it. The suggestion is never applied on its
 * own — a human always files (AI-13: the assistant surfaces, it never acts).
 */
export function TriageBar({
  requestId,
  suggestedCategory,
  suggestedUrgency,
  staff,
}: {
  requestId: string;
  suggestedCategory: string | null;
  suggestedUrgency: string | null;
  staff: Array<{ id: string; name: string; roleLabel: string }>;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(suggestedCategory ?? 'meetings');
  const [urg, setUrg] = useState<Urgency>((suggestedUrgency as Urgency) ?? 'normal');
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A capability deny (core/permissions.ts) arrives as a thrown reason — e.g. filing a
  // safeguarding item without the named 'view_safeguarding' grant. Show it; a refusal a
  // person can read gets respected rather than reported as "the button is broken".
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try { await fn(); } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    });

  const suggestedLabel = categoryDef(suggestedCategory)?.label ?? 'Untriaged';
  const hint = CATEGORIES.find(c => c.key === cat)?.ownerHint;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(async () => {
          await fileRequest(requestId, suggestedCategory ?? 'meetings', (suggestedUrgency as Urgency) ?? 'normal');
        })}
        className="fh-btn fh-btn--primary fh-btn--sm"
      >
        Accept · {suggestedLabel}
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen(o => !o)}
        className="fh-btn fh-btn--outline fh-btn--sm"
      >
        {open ? 'Cancel' : 'Change'}
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(async () => { await markNotARequest(requestId); })}
        className="fh-btn fh-btn--ghost fh-btn--sm"
      >
        Not a parent request
      </button>

      {open && (
        <div className="w-full mt-2 flex flex-wrap items-end gap-2 rounded-md bg-surface-sunken p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Category</span>
            <select
              value={cat}
              onChange={e => setCat(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              {CATEGORIES.filter(c => c.key !== 'not-a-request').map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Urgency</span>
            <select
              value={urg}
              onChange={e => setUrg(e.target.value as Urgency)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              {URGENCIES.map(u => <option key={u} value={u}>{urgencyLabel(u)}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
              Owner{hint ? ` · usually ${hint}` : ''}
            </span>
            <select
              value={owner}
              onChange={e => setOwner(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground max-w-[280px]"
            >
              <option value="">Leave unassigned</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.roleLabel}</option>)}
            </select>
          </label>

          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => {
              await fileRequest(requestId, cat, urg);
              if (owner) await assign(requestId, owner);
              setOpen(false);
            })}
            className="fh-btn fh-btn--primary fh-btn--sm"
          >
            File it
          </button>
        </div>
      )}

      {error && (
        <p className="w-full rounded-md bg-danger-subtle border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
