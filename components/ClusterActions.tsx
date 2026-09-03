'use client';

// The QM-D19 action panel: one human decision, fanned out per member — with a confirmation
// that shows EXACTLY how many records will be touched and names every skipped one before
// anything is written. The preview runs the same pure planner (core/cluster-actions.ts) the
// server applies, so what you confirm is what happens.

import { useMemo, useState, useTransition } from 'react';
import { planClusterAction, type ClusterActionKind } from '@/core/cluster-actions';
import { clusterNote, clusterAssign, clusterResolve } from '@/app/cluster-actions';
import { NewBadge, Quiet } from '@/components/bits';

interface Member {
  id: string;
  ref: string;
  status: string;
  ownerId: string | null;
}

export function ClusterActions({
  clusterId,
  clusterLabel,
  members,
  staff,
}: {
  clusterId: string;
  clusterLabel: string;
  members: Member[];
  staff: Array<{ id: string; name: string; roleLabel: string }>;
}) {
  const [mode, setMode] = useState<ClusterActionKind | null>(null);
  const [text, setText] = useState('');
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const assignee = staff.find(s => s.id === staffId);

  // Same pure planner the server runs — the confirmation is a preview, not an estimate.
  const plan = useMemo(() => {
    if (!mode) return null;
    if (mode === 'note' && !text.trim()) return null;
    if (mode === 'assign' && !assignee) return null;
    try {
      return planClusterAction({
        action: mode, clusterLabel, members,
        note: text,
        assignee: assignee ? { id: assignee.id, name: assignee.name } : undefined,
      });
    } catch {
      return null;
    }
  }, [mode, text, assignee, clusterLabel, members]);

  const arm = (m: ClusterActionKind) => {
    setMode(cur => (cur === m ? null : m));
    setText('');
    setStaffId('');
    setError(null);
    setDone(null);
  };

  const confirm = () => {
    if (!mode) return;
    start(async () => {
      setError(null);
      try {
        const summary =
          mode === 'note' ? await clusterNote(clusterId, text)
          : mode === 'assign' ? await clusterAssign(clusterId, staffId)
          : await clusterResolve(clusterId, text);
        setDone(`Done — ${summary.applied} member${summary.applied === 1 ? '' : 's'} updated, ${summary.skipped} skipped.`);
        setMode(null);
        setText('');
        setStaffId('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      }
    });
  };

  const toggle = (m: ClusterActionKind, label: string) => (
    <button
      type="button"
      disabled={pending}
      onClick={() => arm(m)}
      className={`fh-btn fh-btn--outline fh-btn--sm ${mode === m ? 'is-active' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-4 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Quiet>Act on the whole cluster</Quiet>
        <NewBadge />
        <div className="ml-auto flex gap-2">
          {toggle('note', 'Note all')}
          {toggle('assign', 'Assign all')}
          {toggle('resolve', 'Resolve all')}
        </div>
      </div>

      {mode && (
        <div className="mt-3 flex flex-col gap-2.5">
          {mode === 'assign' ? (
            <select
              value={staffId}
              disabled={pending}
              onChange={e => setStaffId(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground max-w-[340px]"
            >
              <option value="">Who takes the whole cluster?</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.roleLabel}</option>)}
            </select>
          ) : (
            <textarea
              rows={2}
              value={text}
              disabled={pending}
              onChange={e => setText(e.target.value)}
              placeholder={mode === 'note'
                ? 'The note every member gets on its trail…'
                : 'Resolution note — e.g. where the one public answer went out (optional)…'}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground resize-y"
            />
          )}

          {plan ? (
            <div className="rounded-md bg-surface-sunken p-3">
              <p className="text-sm text-foreground">
                This will write to <strong>{plan.apply.length}</strong> of{' '}
                <strong>{members.length}</strong> member{members.length === 1 ? '' : 's'} — each
                gets its own trail entry naming this cluster.
              </p>
              {plan.skipped.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {plan.skipped.map(s => (
                    <li key={s.memberId} className="text-sm text-muted">Skipped: {s.reason}</li>
                  ))}
                </ul>
              )}
              {/* Satisfaction is the complainant's own rating, always set per family — QM-D18. */}
              <p className="text-xs text-subtle mt-1.5">
                Satisfaction is never set by a cluster action — each family is asked
                individually.
              </p>
            </div>
          ) : (
            <p className="text-sm text-subtle">
              {mode === 'assign' ? 'Choose who takes it to see what will change.' : 'Write the note to see what will change.'}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || !plan || plan.apply.length === 0}
              onClick={confirm}
              className="fh-btn fh-btn--primary fh-btn--sm"
            >
              {plan && plan.apply.length > 0
                ? `Confirm — ${plan.apply.length} member${plan.apply.length === 1 ? '' : 's'}`
                : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => arm(mode)}
              className="fh-btn fh-btn--ghost fh-btn--sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && <p className="mt-2 text-sm font-medium text-success">{done}</p>}
      {error && (
        <p className="mt-2 rounded-md bg-danger-subtle border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
