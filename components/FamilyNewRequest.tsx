'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitRequest } from '@/app/family-actions';
import { PARENT_MENU } from '@/core/taxonomy';

/**
 * The new-request form — the app rail's front door (QM-D34 / SD-COM-3). The category menu is
 * the deterministic category→door list: picking from it IS the routing, which is why
 * submission is filing on this rail and no triage step exists.
 *
 * There is deliberately NO urgency field: a parent doesn't triage. Urgency is suggested by
 * the assistant and reviewed by staff — asking a parent to grade their own emergency invites
 * everything to be "urgent" and nothing to mean it.
 */
export function FamilyNewRequest() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="fh-card p-5 flex flex-col gap-4"
      onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        start(async () => {
          setError(null);
          try {
            const ref = await submitRequest(data);
            form.reset();
            // Filed on submission (QM-D34(5)) — so the thread exists the moment the button is
            // released, and "request received" is a fact, not a promise. Land the parent on it.
            router.push(`/family/r/${ref}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'That did not work.');
          }
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
          What is this about?
        </span>
        <select
          name="category"
          required
          defaultValue=""
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground max-w-[360px]"
        >
          <option value="" disabled>
            — choose —
          </option>
          {PARENT_MENU.map(m => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
          In a few words
        </span>
        <input
          name="subject"
          required
          placeholder="e.g. Request to shift our bus stop"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
          Your message
        </span>
        <textarea
          name="body"
          required
          rows={4}
          placeholder="Say what you need — this goes straight to the right desk."
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground resize-y"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
            Child&rsquo;s grade (optional)
          </span>
          <input
            name="grade"
            placeholder="e.g. Grade 4"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground w-[160px]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
            Section (optional)
          </span>
          <input
            name="section"
            placeholder="e.g. Freedom"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground w-[160px]"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          disabled={pending}
          className="fh-btn fh-btn--primary fh-btn--sm"
        >
          {pending ? 'Sending…' : 'Send to the school'}
        </button>
        <span className="text-xs text-subtle">
          You&rsquo;ll see the conversation — and every reply — right here.
        </span>
      </div>

      {error && (
        <p className="rounded-md bg-danger-subtle border border-border px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
