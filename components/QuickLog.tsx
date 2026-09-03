'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { quickLog } from '@/app/actions';
import { CHANNELS, CHANNEL_LABEL, CALLER_RELATIONSHIPS } from '@/core/taxonomy';
import { looksLikeSwitchboard } from '@/core/classify';
import { normalisePhone } from '@/core/phone';

export function QuickLog({
  campuses,
  families,
  staff,
}: {
  campuses: Array<{ id: string; code: string; name: string }>;
  families: Array<{ id: string; label: string; campusOrgUnitId: string; phoneKeys: string[] }>;
  staff: Array<{ id: string; name: string; roleLabel: string }>;
}) {
  const [pending, start] = useTransition();
  const [channel, setChannel] = useState<string>('call');
  // No default when the actor can see more than one campus. Defaulting to the first one
  // silently mis-files a call under whichever campus sorts first — a group-scoped user has no
  // "home" campus, so they must choose.
  const [campus, setCampus] = useState(campuses.length === 1 ? campuses[0].id : '');
  const [subject, setSubject] = useState('');
  const switchboard = looksLikeSwitchboard(subject).yes;
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ ref: string; seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // "A known number fills this in" (2026-08-12): matched entirely client-side against the
  // families already on the page — no round trip, and no phone number is stored anywhere by
  // this lookup, it only pre-selects the dropdown below. Empty until real phone data exists on
  // any Family (see BACKLOG.md); harmless either way.
  const [phone, setPhone] = useState('');
  const [familyId, setFamilyId] = useState('');
  const phoneMatch = (() => {
    const key = normalisePhone(phone);
    return key ? families.find(f => f.phoneKeys.includes(key)) ?? null : null;
  })();

  // Start the clock on the first keystroke or choice, not on page load.
  useEffect(() => {
    if (startedAt.current === null) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current!) / 1000)), 250);
    return () => clearInterval(t);
  }, [result]);

  // Fills the dropdown in, doesn't lock it — staff can still pick a different family by hand.
  // Corrects the campus too: a real phone match is a stronger signal than whichever campus
  // happened to be selected first.
  useEffect(() => {
    if (!phoneMatch) return;
    setFamilyId(phoneMatch.id);
    setCampus(phoneMatch.campusOrgUnitId);
  }, [phoneMatch]);

  const touch = () => { if (startedAt.current === null) startedAt.current = Date.now(); };

  const eligible = families.filter(f => f.campusOrgUnitId === campus);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {/* Email is excluded because it ingests itself; everything else — including App
            (QM-D34), for when a parent shows the desk a submission that has not synced or the
            rail is down — can be logged by hand. Capture must never depend on one pipe. */}
        {CHANNELS.filter(c => c !== 'email').map(c => (
          <button
            key={c}
            type="button"
            onClick={() => { touch(); setChannel(c); }}
            className={`rounded-md px-4 py-2.5 text-sm font-medium border transition-colors ${
              channel === c
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-surface border-border text-muted hover:bg-surface-sunken'
            }`}
          >
            {CHANNEL_LABEL[c]}
          </button>
        ))}
      </div>

      <form
        ref={formRef}
        onChange={touch}
        action={(fd) => start(async () => {
          setError(null);
          const seconds = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
          try {
            const ref = await quickLog(fd);
            setResult({ ref, seconds });
            formRef.current?.reset();
            startedAt.current = null;
            setElapsed(0);
            setPhone('');
            setFamilyId('');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not log that.');
          }
        })}
        className="fh-card p-5 flex flex-col gap-4"
      >
        <input type="hidden" name="channel" value={channel} />

        <div className="grid sm:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Campus</span>
            <select
              name="campus"
              value={campus}
              required
              onChange={e => setCampus(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              {campuses.length !== 1 && <option value="">Choose a campus…</option>}
              {campuses.map(c => <option key={c.id} value={c.id}>{c.code.toUpperCase()} — {c.name}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
              Phone number <span className="normal-case tracking-normal">(optional — matches the family below)</span>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="99000 00123"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
              Which family?{' '}
              {phoneMatch ? (
                <span className="normal-case tracking-normal text-success">— matched by phone</span>
              ) : (
                <span className="normal-case tracking-normal">(optional — a known number fills this in)</span>
              )}
            </span>
            <select
              name="familyId"
              value={familyId}
              onChange={e => setFamilyId(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              <option value="">Not identified</option>
              {eligible.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
        </div>

        {/* Mirrors the Daily Call Log's own columns — the desk already fills these in. */}
        <div className="grid sm:grid-cols-3 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Who called?</span>
            <select name="callerRelationship" className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground">
              <option value="">Not recorded</option>
              {CALLER_RELATIONSHIPS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Grade</span>
            <input name="grade" placeholder="Grade 4" className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-subtle">Section</span>
            <input name="section" placeholder="Freedom" className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground" />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-subtle">What was it about?</span>
          <input
            name="subject"
            required
            onChange={e => setSubject(e.target.value)}
            placeholder="Bus 7 was late again and nobody messaged"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
            Message passed to <span className="normal-case tracking-normal">(leave blank if you handled it)</span>
          </span>
          <select name="routedToId" className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground">
            <option value="">I handled it myself</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.roleLabel}</option>)}
          </select>
        </label>

        {switchboard && (
          <p className="rounded-md bg-surface-sunken border-l-4 border-secondary px-3 py-2 text-sm text-muted">
            This reads like a <strong>message for someone else</strong> rather than something to
            act on. It will still be logged and owned — just kept out of the working queue so the
            real requests stay visible.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-subtle">
            What did we say or promise? <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <textarea
            name="body"
            rows={3}
            placeholder="Told them we would check with the operator and call back before 11."
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground resize-y"
          />
        </label>

        <label className="flex items-center gap-2.5 text-sm">
          <input name="doneNow" type="checkbox" className="h-4 w-4" />
          <span>Done — nothing pending <span className="text-subtle text-xs">(most walk-ins)</span></span>
        </label>

        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="submit"
            disabled={pending}
            className="fh-btn fh-btn--primary"
          >
            {pending ? 'Logging…' : 'Log it'}
          </button>
          <span className={`text-sm tabular-nums ${elapsed > 20 ? 'text-danger font-semibold' : 'text-subtle'}`}>
            {startedAt.current === null ? 'Timer starts when you type' : `${elapsed}s elapsed`}
          </span>
        </div>

        {error && (
          <p className="rounded-md bg-danger-subtle border border-danger px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>

      {result && (
        <div className="rounded-lg bg-success-subtle border border-success px-4 py-3">
          <p className="text-sm">
            Logged as <strong>{result.ref}</strong> in <strong>{result.seconds}s</strong>
            {result.seconds <= 20
              ? ' — inside the twenty-second target.'
              : ' — over the twenty-second target, which means the form still needs work.'}
          </p>
        </div>
      )}
    </div>
  );
}
