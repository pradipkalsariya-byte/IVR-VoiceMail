'use client';

import { useState, useTransition } from 'react';
import { bringIntoQueue } from '@/app/actions';

// Register #5's second half, in VK's words: "front desk decides."
//
// The app sets internal mail aside when it can see no request in it. This is how a person
// disagrees. It is deliberately LIGHTER than filing: filing makes you choose a category and an
// urgency there and then, which is a real decision somebody may not be ready to make while
// glancing at a record. This just says "yes it does need doing" and puts it back as untriaged,
// to be filed like anything else.
//
// Both routes stay available — the filing controls sit directly above this.

export function BringBack({ requestId }: { requestId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          try { await bringIntoQueue(requestId); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        })}
        className="fh-btn fh-btn--ghost fh-btn--sm self-start"
      >
        {pending ? 'Putting it back…' : 'This does need doing — put it back in the queue'}
      </button>
      <span className="text-xs text-subtle">
        It returns untriaged, with its response clock counted from when the message arrived —
        not from now.
      </span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
