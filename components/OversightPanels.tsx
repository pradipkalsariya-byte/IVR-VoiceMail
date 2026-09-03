import { Card, Quiet, SectionTitle } from '@/components/bits';
import { categoryDef } from '@/core/taxonomy';
import type { AgeingBucket, DemandRow, HealthSummary } from '@/core/oversight';

// Feedback #30 — the two questions this page should answer, side by side.
//
// Plain CSS bars rather than SVG or a chart library. front-desk vendors the design-system CSS
// instead of depending on the package, so the DS chart primitives are not importable here;
// this is the tracked DS gap, and VK's 2026-08-20 ruling was to unblock the app that needs it
// rather than wait for a retrofit. When front-desk moves to the package dependency these
// should be replaced by GroupedBarChart / StackedBar rather than kept.
//
// One DS rule is honoured regardless: a NULL datum is not a zero. "Nothing resolved this month"
// renders as a dash and a sentence, never as a bar of length zero, which would read as "we
// resolved things instantly".

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  // ZERO DRAWS NOTHING. The floor below keeps a small non-zero value visible, and applying it
  // to zero as well made "none this fortnight" render as a short bar — indistinguishable from
  // "a few this fortnight", which is the exact confusion the no-zero-scaled-bar rule exists to
  // prevent. Caught by looking at the page: every category read "0 vs N" while showing a stub.
  if (value <= 0 || max <= 0) {
    return <div className="h-2 w-full rounded-full bg-border/40" aria-label="none" />;
  }
  const pct = Math.max(3, Math.round((value / max) * 100));
  return (
    <div className="h-2 w-full rounded-full bg-border/60 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function WhereItIsFailing({
  health, ageing, medianDays, chasesOwed,
}: {
  health: HealthSummary;
  ageing: AgeingBucket[];
  medianDays: number | null;
  chasesOwed: number;
}) {
  const maxAge = Math.max(...ageing.map(a => a.count), 1);
  const worst = ageing.at(-1)?.count ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle note="Requests, never people. This page finds where the process fails, not who to blame.">
        Where the system is failing
      </SectionTitle>

      <Card stripe={health.breached || worst ? 'critical' : 'normal'} className="p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Quiet>How long open work has been waiting</Quiet>
            <div className="mt-2 flex flex-col gap-2">
              {ageing.map(b => (
                <div key={b.key} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted">{b.label}</span>
                  <Bar
                    value={b.count}
                    max={maxAge}
                    tone={b.key === 'older' || b.key === 'fortnight' ? 'bg-danger' : 'bg-primary'}
                  />
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums">{b.count}</span>
                </div>
              ))}
            </div>
            {worst > 0 && (
              <p className="mt-3 text-sm text-danger">
                {worst} {worst === 1 ? 'request has' : 'requests have'} been waiting over a
                fortnight. That is the number worth a conversation.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Line
              label="Open right now"
              value={String(health.open)}
              note={health.unowned ? `${health.unowned} with nobody's name on ${health.unowned === 1 ? 'it' : 'them'}` : 'all owned'}
              bad={health.unowned > 0}
            />
            <Line
              label="Past their target, no reply yet"
              value={String(health.breached)}
              note={health.breached ? 'the family is still waiting' : 'nothing overdue'}
              bad={health.breached > 0}
            />
            <Line
              label="Oldest open request"
              value={health.oldestOpenDays === null ? '—' : `${health.oldestOpenDays}d`}
              note={health.oldestOpenDays === null ? 'nothing is open' : 'since the family first wrote'}
              bad={(health.oldestOpenDays ?? 0) > 14}
            />
            <Line
              label="Typical time to resolve"
              value={medianDays === null ? '—' : `${medianDays}d`}
              note={medianDays === null ? 'nothing resolved in the last month' : 'median, last 30 days'}
              bad={false}
            />
            <Line
              label="Owed a chase"
              value={String(chasesOwed)}
              note="a rising count means the earlier rungs are failing, not that the desk is lazy"
              bad={chasesOwed > 0}
            />
          </div>
        </div>
      </Card>
    </section>
  );
}

function Line({ label, value, note, bad }: { label: string; value: string; note: string; bad: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className={`w-14 shrink-0 text-right font-heading text-xl font-semibold tabular-nums ${bad ? 'text-danger' : ''}`}>
        {value}
      </span>
      <span className="text-sm">
        {label}
        <span className="block text-xs text-subtle">{note}</span>
      </span>
    </div>
  );
}

export function WhatFamiliesAsk({ demand, rising }: { demand: DemandRow[]; rising: DemandRow[] }) {
  const top = demand.slice(0, 8);
  const max = Math.max(...top.map(d => Math.max(d.current, d.previous)), 1);

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle note="The last fortnight against the one before it. What to fix at source, rather than answer twice.">
        What families are asking about
      </SectionTitle>

      {top.length === 0 ? (
        <p className="text-subtle text-sm">
          Nothing categorised in the last month — there is no demand picture to draw yet.
        </p>
      ) : top.every(d => d.current === 0) ? (
        <Card stripe="normal" className="p-4">
          <p className="text-sm">
            Nothing has arrived in the last fortnight. The bars below would all be empty, so
            there is nothing to compare yet — the figures on the right are the fortnight before.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {top.map(d => (
              <span key={d.category}>
                {categoryDef(d.category)?.label ?? d.category}{' '}
                <strong className="tabular-nums text-foreground">{d.previous}</strong>
              </span>
            ))}
          </div>
        </Card>
      ) : (
        <Card stripe="normal" className="p-4 flex flex-col gap-3">
          {top.map(d => (
            <div key={d.category} className="flex items-center gap-3">
              <span className="w-44 shrink-0 truncate text-sm">
                {categoryDef(d.category)?.label ?? d.category}
              </span>
              <div className="flex-1 flex flex-col gap-1">
                <Bar value={d.current} max={max} tone="bg-primary" />
                <Bar value={d.previous} max={max} tone="bg-border" />
              </div>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                {d.current}
                <span className="text-subtle"> vs {d.previous}</span>
              </span>
            </div>
          ))}
          <Quiet>Solid bar: the last fortnight. Faint bar: the fortnight before it.</Quiet>
        </Card>
      )}

      {rising.length > 0 && (
        <Card stripe="high" className="p-4">
          <Quiet>Worth a conversation</Quiet>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {rising.map(d => (
              <li key={d.category}>
                <strong>{categoryDef(d.category)?.label ?? d.category}</strong> is up from{' '}
                {d.previous} to {d.current} this fortnight
                {d.change !== null && <> — {Math.round(d.change * 100)}% more</>}.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-subtle">
            Only categories with real volume behind them appear here. Two becoming four is a
            100% rise and almost always noise.
          </p>
        </Card>
      )}
    </section>
  );
}
