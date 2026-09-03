'use client';

import { useState, useTransition } from 'react';
import { blockCaller } from '@/app/actions';

// Stop a number's missed calls becoming callback slips.
//
// Two deliberate frictions, because this is the most destructive-looking control on the screen
// even though it destroys nothing:
//
//   · It asks for a REASON before it will do anything. Somebody reads this in November.
//   · It says plainly that the calls are kept, because "block" reads as "delete" to most people
//     and a desk that thinks its history is being erased will not use the button at all.

export function BlockCaller({ phone, calls }: { phone: string; calls: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) return <span className="text-xs text-muted">{done}</span>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-xs text-muted underline hover:no-underline hover:text-foreground">
        Stop callbacks from this number
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Why? e.g. school's own extension, not a parent"
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
        aria-label="Reason for blocking"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => start(async () => {
            setError(null);
            try {
              const r = await blockCaller(phone, reason);
              setDone(`Blocked. ${r.retired} slip${r.retired === 1 ? '' : 's'} set aside — still on the record.`);
            } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          })}
          className="fh-btn fh-btn--sm fh-btn--ghost"
        >
          {pending ? 'Blocking…' : `Block, and set aside ${calls} call${calls === 1 ? '' : 's'}`}
        </button>
        <button type="button" onClick={() => { setOpen(false); setReason(''); }}
          className="text-xs text-subtle underline hover:no-underline">cancel</button>
      </div>
      <span className="text-xs text-subtle">
        Future calls from this number stop making slips. Nothing is deleted — the calls stay on
        the record, out of the callback list.
      </span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
