'use client';

import { useTransition } from 'react';
import { setActor } from '@/app/actions';

/**
 * Demo identity switcher. Switching sets a cookie so READS and WRITES stay coherent — the
 * lesson from the Nucleus write-identity fix: a client must never be able to name the actor
 * on a per-request basis. Inert under a real session gate.
 */
export function ActingAs({
  actorId,
  staff,
}: {
  actorId: string;
  staff: Array<{ id: string; name: string; roleLabel: string }>;
}) {
  const [pending, start] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-subtle">Acting as</span>
      <select
        value={actorId}
        disabled={pending}
        onChange={e => start(() => void setActor(e.target.value))}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground max-w-[260px]"
      >
        {staff.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.roleLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
