'use client';

import { useState, useTransition } from 'react';
import { logChase } from '@/app/chase-actions';

/**
 * The "Log chase" control on the Chases-owed strip (QM-D14). The input is deliberately one
 * small line: an outcome is the ACT — "reached the owner", "left a message" — never the
 * story, and the server refuses anything long enough to become one.
 */
export function ChaseLog({ requestId }: { requestId: string }) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A refusal (scope, audience exclusion, an empty outcome) arrives as a thrown reason —
  // shown, not swallowed, same as TriageBar: a refusal a person can read gets respected.
  const submit = () =>
    start(async () => {
      setError(null);
      try {
        await logChase(requestId, outcome);
        setOutcome('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          value={outcome}
          onChange={e => setOutcome(e.target.value)}
          maxLength={140}
          placeholder="Reached the owner / left a message"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground w-[240px]"
        />
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="fh-btn fh-btn--primary fh-btn--sm"
        >
          Log chase
        </button>
      </div>
      {error && (
        <p className="max-w-[340px] text-right text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
