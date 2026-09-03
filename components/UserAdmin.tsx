'use client';

import { useState, useTransition } from 'react';
import { upsertStaffAccess, revokeStaffAccess } from '@/app/user-actions';
import { ACTIONS } from '@/core/permissions';
import { safeguardingWarning, type RolePreset } from '@/core/user-admin';

// The add/change form for desk access — feedback #34.
//
// Presets first, capabilities underneath. Nobody adding a colleague should have to reason about
// seven checkboxes to do the common thing, but the checkboxes stay visible because the grant
// list is what actually governs (QM-D9/D26: no read may key on a role label).

const CAPABILITY_HINT: Record<string, string> = {
  view_queue: 'See requests for their campus.',
  file: 'Decide what a request is, and put it into the working queue.',
  assign: 'Give a request an owner.',
  resolve: 'Close a request once the family has an answer.',
  oversight: 'Read the oversight view. Volume and ageing, never a per-person score.',
  triage_approve: 'Be the second pair of eyes on a serious item.',
  view_safeguarding: 'Open safeguarding records. Named-access — grant to a person, not a team.',
};

export function UserAdmin({
  campuses, presets, existing, actorEmail,
}: {
  campuses: Array<{ id: string; code: string; name: string }>;
  presets: RolePreset[];
  existing: Array<{
    email: string; name: string; roleLabel: string; scopeOrgUnitId: string;
    /** 'group' for every campus. Empty means added but not yet given a campus. */
    campusOrgUnitIds: string[];
    permissions: string[];
  }>;
  actorEmail: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleLabel, setRoleLabel] = useState('Front Desk');
  // A LIST, not one campus (27-Aug-2026). Somebody covering FSK and FWGS used to need
  // 'group' -- every campus, present and future -- which is how a testing account
  // quietly becomes an estate-wide one.
  const [campusIds, setCampusIds] = useState<string[]>([campuses[0]?.id ?? 'group']);
  const everyCampus = campusIds.includes('group');
  const [perms, setPerms] = useState<string[]>(presets[0]?.permissions ?? []);

  const known = existing.find(e => e.email.toLowerCase() === email.trim().toLowerCase());
  const warning = safeguardingWarning(perms);

  const applyPreset = (p: RolePreset) => {
    setPerms([...p.permissions]);
    setRoleLabel(p.label);
  };

  const loadExisting = (e: typeof existing[number]) => {
    setEmail(e.email); setName(e.name); setRoleLabel(e.roleLabel);
    setCampusIds(e.campusOrgUnitIds.length ? [...e.campusOrgUnitIds] : [e.scopeOrgUnitId]);
    setPerms([...e.permissions]);
    setError(null); setDone(null);
  };

  const run = (fn: () => Promise<void>) => start(async () => {
    setError(null); setDone(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-heading text-lg font-semibold">
            {known ? `Change access for ${known.name}` : 'Give someone access'}
          </h2>
          {existing.length > 0 && (
            <label className="text-sm text-muted flex items-center gap-2">
              or edit someone
              <select
                value=""
                onChange={e => {
                  const found = existing.find(x => x.email === e.target.value);
                  if (found) loadExisting(found);
                }}
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
              >
                <option value="">choose…</option>
                {existing.map(e => (
                  <option key={e.email} value={e.email}>
                    {e.name} {e.permissions.length ? '' : '(no access)'}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">School email</span>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="smita.henry@fountainheadschools.org"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <span className="text-xs text-subtle">
              Must be a Fountainhead address — anything else could never sign in.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Smita Henry"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <span className="text-xs text-subtle">The audit trail records a person, not an address.</span>
          </label>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Campuses</span>
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3">
              {campuses.map(c => (
                <label key={c.id} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={everyCampus || campusIds.includes(c.id)}
                    disabled={everyCampus}
                    onChange={e => setCampusIds(prev =>
                      e.target.checked ? [...prev, c.id] : prev.filter(x => x !== c.id))}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
              <label className="inline-flex items-center gap-2 border-t border-border pt-1.5 mt-0.5">
                <input
                  type="checkbox"
                  checked={everyCampus}
                  onChange={e => setCampusIds(e.target.checked
                    ? ['group']
                    : campuses[0] ? [campuses[0].id] : [])}
                />
                <span>Every campus</span>
              </label>
            </div>
            <span className="text-xs text-subtle">
              {everyCampus
                ? 'Includes any campus opened later. Tick the individual ones instead if that is not what you mean.'
                : campusIds.length === 0
                  ? 'They will be able to sign in and see nothing until you tick a campus.'
                  : 'Only the campuses ticked. A campus added later will not be included.'}
            </span>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Role label</span>
            <input
              value={roleLabel}
              onChange={e => setRoleLabel(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <span className="text-xs text-subtle">A description shown beside their name. Not a permission.</span>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Start from</span>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button
                key={p.key}
                type="button"
                title={p.hint}
                onClick={() => applyPreset(p)}
                className="rounded-full border border-border px-3 py-1 text-sm hover:border-primary"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">What they can do</span>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ACTIONS.map(a => (
              <label key={a} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={perms.includes(a)}
                  onChange={e =>
                    setPerms(prev => e.target.checked ? [...prev, a] : prev.filter(x => x !== a))
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-mono text-xs">{a}</span>
                  <span className="block text-xs text-subtle">{CAPABILITY_HINT[a]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {warning && (
          <p className="rounded-md bg-warning/10 border border-warning/30 p-3 text-sm">{warning}</p>
        )}
        {error && (
          <p className="rounded-md bg-danger/10 border border-danger/30 p-3 text-sm">{error}</p>
        )}
        {done && (
          <p className="rounded-md bg-success/10 border border-success/30 p-3 text-sm">{done}</p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => {
              // scopeOrgUnitId is the legacy column, still written for one release. It is
              // DERIVED here rather than asked for, so the form has one source of truth.
              const legacyScope = everyCampus ? 'group' : (campusIds[0] ?? 'group');
              await upsertStaffAccess({
                email, name, roleLabel,
                scopeOrgUnitId: legacyScope,
                campusOrgUnitIds: campusIds,
                permissions: perms,
              });
              const where = everyCampus
                ? 'every campus'
                : campusIds.length === 0
                  ? 'no campus yet — tick one to let them see anything'
                  : campusIds.map(id => campuses.find(c => c.id === id)?.name ?? id).join(', ');
              setDone(`${name || email} can now sign in. Campuses: ${where}.`);
            })}
            className="fh-btn fh-btn--primary"
          >
            {known ? 'Save changes' : 'Give access'}
          </button>

          {known && known.permissions.length > 0 && known.email.toLowerCase() !== actorEmail.toLowerCase() && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(async () => {
                await revokeStaffAccess(known.email);
                setDone(`${known.name} no longer has access. They stay on file so past records still read correctly.`);
                setPerms([]);
              })}
              className="text-sm text-danger underline hover:no-underline"
            >
              Remove access
            </button>
          )}
          {pending && <span className="text-sm text-muted">Saving…</span>}
        </div>
      </div>
    </section>
  );
}
