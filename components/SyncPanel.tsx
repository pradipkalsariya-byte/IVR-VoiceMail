'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { syncMail } from '@/app/actions';

type Result = Awaited<ReturnType<typeof syncMail>>;

/**
 * The Pull control. Lives on the Mailbox page since the email-visibility round (2026-08-24) —
 * the queue carries a one-line status strip instead. Every press is now on the record (an
 * IngestRun row renders in the passes table below within the same navigation), so the inline
 * result here is a courtesy echo, not the only trace it leaves.
 */
export function SyncPanel({ sourceName, ready, readyReason }: {
  sourceName: string; ready: boolean; readyReason: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const live = sourceName === 'gmail' && ready;
  const summary = result?.ran ? result.summary : undefined;

  return (
    <div className="fh-card p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Mail source</span>
        <span
          className={`fh-badge ${live ? 'fh-badge--success' : 'fh-badge--warning'}`}
          title={live ? undefined : 'The Gmail adapter is written and tested. Going live needs the member-mailbox credentials and the desk-mail filter — no code change.'}
        >
          {live ? 'Live' : sourceName === 'gmail' ? 'Gmail — not activated' : 'Demo'}
        </span>
        <span className="text-sm text-muted flex-1 min-w-[200px] truncate" title={readyReason}>
          {readyReason}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            setError(null);
            try {
              const r = await syncMail();
              setResult(r);
              router.refresh();
            } catch (e) { setError(e instanceof Error ? e.message : 'Sync failed.'); }
          })}
          className="fh-btn fh-btn--outline fh-btn--sm ml-auto"
        >
          {pending ? 'Pulling…' : 'Pull new mail'}
        </button>
      </div>

      {result && !result.ran && (
        <div className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-sm text-muted">{result.reason}</div>
      )}

      {summary && (
        <div className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-sm text-muted">
          Fetched <strong>{summary.fetched}</strong> · new <strong>{summary.created}</strong>
          {' '}· replies added to existing threads <strong>{summary.appended}</strong>
          {' '}· already had <strong>{summary.skipped}</strong>
          {summary.parked > 0 && <> · parked as automated or vendor <strong>{summary.parked}</strong></>}
          {summary.errors.length > 0 && (
            <div className="mt-1 text-danger">
              {summary.errors.length} message{summary.errors.length === 1 ? '' : 's'} failed: {summary.errors[0]}
            </div>
          )}
          {summary.fetched > 0 && summary.created === 0 && summary.appended === 0 && (
            <div className="mt-1">Nothing new — every message was already stored.</div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-danger-subtle border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
