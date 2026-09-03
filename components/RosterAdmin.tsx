'use client';

import { useState, useTransition } from 'react';
import { setRosterDay, generateRoster, setCategoryRoute, setAway } from '@/app/roster-actions';

// The editable half of the roster page (feedback #18, #21, and the away flag from #20).

const DAY_LABEL = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
  });

export function RosterAdmin({
  campusOrgUnitId, canEdit, staff, days, categories, routes,
}: {
  campusOrgUnitId: string;
  canEdit: boolean;
  staff: Array<{ id: string; name: string; roleLabel: string; awayUntil: string | null }>;
  days: Array<{ iso: string; onDuty: Array<{ id: string; name: string }> }>;
  categories: Array<{ key: string; label: string }>;
  routes: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rotationPick, setRotationPick] = useState<string[]>(staff.map(s => s.id));

  const run = (fn: () => Promise<void>) => start(async () => {
    setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });

  const toggleOnDuty = (iso: string, current: Array<{ id: string }>, staffId: string) => {
    const next = current.some(c => c.id === staffId)
      ? current.filter(c => c.id !== staffId).map(c => c.id)
      : [...current.map(c => c.id), staffId];
    run(() => setRosterDay(campusOrgUnitId, iso, next));
  };

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="rounded-md bg-danger/10 border border-danger/30 p-3 text-sm">{error}</p>}
      {note && <p className="rounded-md bg-success/10 border border-success/30 p-3 text-sm">{note}</p>}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-heading text-lg font-semibold">The next fortnight</h2>
          {canEdit && (
            <button
              type="button"
              disabled={pending || rotationPick.length === 0}
              onClick={() => run(async () => {
                const r = await generateRoster(
                  campusOrgUnitId, rotationPick, days[0].iso, days.length,
                );
                setNote(
                  `Filled ${r.filled} day${r.filled === 1 ? '' : 's'}` +
                  (r.skipped
                    ? `, leaving ${r.skipped} already set exactly as ${r.skipped === 1 ? 'it was' : 'they were'}.`
                    : '.'),
                );
              })}
              className="fh-btn fh-btn--primary"
            >
              Fill the empty days by rotation
            </button>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Rotate between:</span>
            {staff.map(s => (
              <label key={s.id} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={rotationPick.includes(s.id)}
                  onChange={e => setRotationPick(prev =>
                    e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id))}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="fh-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Day</th>
                {staff.map(s => (
                  <th key={s.id} className="text-left whitespace-nowrap">
                    {s.name}
                    {s.awayUntil && (
                      <span className="block text-xs text-warning">away until {s.awayUntil}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map(d => (
                <tr key={d.iso}>
                  <td className="whitespace-nowrap font-medium">{DAY_LABEL(d.iso)}</td>
                  {staff.map(s => (
                    <td key={s.id}>
                      <input
                        type="checkbox"
                        checked={d.onDuty.some(o => o.id === s.id)}
                        disabled={!canEdit || pending}
                        onChange={() => toggleOnDuty(d.iso, d.onDuty, s.id)}
                        aria-label={`${s.name} on ${DAY_LABEL(d.iso)}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-subtle">
          A day with nobody ticked is not an error — routing falls back to whoever is available.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">Who usually handles what</h2>
        <p className="text-sm text-muted max-w-[70ch]">
          A default, not a rule. When the named person is off or away the request goes to whoever
          is on duty instead — it never waits for them.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {categories.map(c => (
            <label
              key={c.key}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <span>{c.label}</span>
              <select
                value={routes[c.key] ?? ''}
                disabled={!canEdit || pending}
                onChange={e => run(() => setCategoryRoute(campusOrgUnitId, c.key, e.target.value || null))}
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm max-w-[55%]"
              >
                <option value="">— anyone on duty —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      {canEdit && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold">Mark someone away</h2>
          <p className="text-sm text-muted max-w-[70ch]">
            Anyone here can set this for anyone else — somebody who is unexpectedly out cannot
            set their own flag, and that is exactly the day their queue needs covering.
          </p>
          <div className="flex flex-col gap-2">
            {staff.map(s => (
              <div key={s.id} className="flex items-center gap-3 text-sm flex-wrap">
                <span className="w-44">{s.name}</span>
                <input
                  type="date"
                  defaultValue={s.awayUntil ?? ''}
                  disabled={pending}
                  onChange={e => run(() => setAway(s.id, e.target.value || null))}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                  aria-label={`${s.name} away until`}
                />
                <span className="text-subtle text-xs">
                  {s.awayUntil ? `back on ${s.awayUntil}` : 'available'}
                </span>
                {s.awayUntil && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => setAway(s.id, null))}
                    className="text-primary underline hover:no-underline text-xs"
                  >
                    mark back
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
