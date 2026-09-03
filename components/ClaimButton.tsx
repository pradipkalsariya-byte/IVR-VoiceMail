'use client';

// The claim control for a pool row. One button, one id — the action's signature has no
// target to fill in, so there is nothing else this component COULD send. The refusal reason
// is shown inline rather than swallowed, because the one refusal a user will actually meet
// is the race ("Someone claimed this first…"), and the pool moving under you must read as
// the system working, not breaking.

import { useState, useTransition } from 'react';
import { claim } from '@/app/claim-actions';

export function ClaimButton({ requestId }: { requestId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await claim(requestId);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That did not work.');
            }
          })
        }
        className="fh-btn fh-btn--primary fh-btn--sm"
      >
        {pending ? 'Claiming…' : 'Claim'}
      </button>
      {error && (
        <p className="max-w-[280px] rounded-md border border-danger bg-danger-subtle px-2 py-1 text-right text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
