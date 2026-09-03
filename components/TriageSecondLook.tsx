'use client';

import { useState, useTransition } from 'react';
import { approveTriage } from '@/app/actions';

/**
 * The QM-D10 second-look chip. Deliberately QUIET — an amber outline, not a modal, not a
 * disabled reply box — because the ruling says the approval never gates the response. The
 * approve button renders only when the server said this actor may approve (holds
 * 'triage_approve' and is not the filer); the server action re-checks both regardless.
 */
export function TriageSecondLook({
  requestId,
  mayApprove,
}: {
  requestId: string;
  mayApprove: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="fh-badge fh-badge--warning">
        Awaiting a second look
      </span>
      {mayApprove && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                await approveTriage(requestId);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That did not work.');
              }
            })
          }
          className="fh-btn fh-btn--outline fh-btn--sm"
        >
          I&rsquo;ve read it — approve the filing
        </button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
