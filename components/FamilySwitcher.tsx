'use client';

import { useTransition } from 'react';
import { setFamily } from '@/app/family-actions';

/**
 * Demo seam — the parent-face twin of the staff "Acting as" switcher. Switching sets a
 * cookie so reads and writes stay coherent; a client never names the family per-request.
 * In production this is the verified Google sign-in (QM-D38 — p.<child>@<campus>) and the
 * switcher is inert: you are who you signed in as.
 */
export function FamilySwitcher({
  familyId,
  families,
}: {
  familyId: string;
  families: Array<{ id: string; label: string }>;
}) {
  const [pending, start] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-subtle">Demo · signed in as</span>
      <select
        value={familyId}
        disabled={pending}
        onChange={e => start(() => void setFamily(e.target.value))}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground max-w-[200px]"
      >
        {families.map(f => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );
}
