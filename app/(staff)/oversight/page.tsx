import Link from 'next/link';
import { db } from '@/lib/db';
import { currentActor, visibleCampusIds } from '@/lib/session';
import { Card, NewBadge, Quiet, SectionTitle, Stat, CategoryChip } from '@/components/bits';
import { WhereItIsFailing, WhatFamiliesAsk } from '@/components/OversightPanels';
import {
  healthSummary, ageingBuckets, medianResolutionDays, demandByCategory, growing,
} from '@/core/oversight';
import { slaState } from '@/core/sla';
import { chasesOwed } from '@/core/chase';
import { clusterStats } from '@/core/cluster-actions';
import { CATEGORIES, CHANNELS, CHANNEL_LABEL, type Channel } from '@/core/taxonomy';

export const dynamic = 'force-dynamic';

// One scroll of fifteen ungrouped numbers was the 2026-08-09 review's verdict on this page —
// for an audience of campus leaders, not engineers. Everything stays (VK, 2026-08-09), but
// grouped behind tabs so each visit answers one question at a time.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'campus', label: 'By campus' },
  { key: 'categories', label: 'Categories' },
  { key: 'channels', label: 'Channels' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default async function Oversight({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS.some(t => t.key === rawTab) ? rawTab : 'overview') as Tab;
  const actor = await currentActor();
  const campusIds = await visibleCampusIds(actor);
  const now = new Date();

  const [campuses, rows, clusters, chasedLast7] = await Promise.all([
    db.orgUnit.findMany({ where: { id: { in: campusIds } }, orderBy: { code: 'asc' } }),
    db.request.findMany({
      where: { campusOrgUnitId: { in: campusIds }, isVendorNoise: false },
      // Latest chase per request: the cooldown input for the owed-right-now figure below.
      include: { family: true, owner: true, chases: { orderBy: { openedAt: 'desc' }, take: 1 } },
    }),
    db.cluster.findMany({
      where: { OR: [{ campusOrgUnitId: { in: campusIds } }, { campusOrgUnitId: null }] },
      include: { requests: { select: { id: true, familyId: true, aboutStaffIds: true } } },
      orderBy: { windowStart: 'desc' },
    }),
    db.chase.count({
      where: { campusOrgUnitId: { in: campusIds }, openedAt: { gte: new Date(+now - 7 * 864e5) } },
    }),
  ]);

  // Whole-cluster suppression (QM-D33), same as the queue and /patterns: the grouped list
  // below renders each cluster's LABEL, which carries its members' shared wording. Filtered
  // before the grouped numbers are derived, so the list and its own counts stay consistent —
  // only the person a member concerns sees the smaller figure, which is the point.
  const audienceClusters = clusters.filter(
    c => !c.requests.some(r => r.aboutStaffIds.includes(actor.id)),
  );

  // Feedback #30 — the two questions, computed from the SAME rows every other figure on this
  // page derives from, so the panels and the tiles can never disagree.
  const health = healthSummary(rows, now);
  const ageing = ageingBuckets(rows, now);
  const medianDays = medianResolutionDays(rows, now);
  const demand = demandByCategory(rows, now);
  const rising = growing(demand);

  // QM-D19's binding counting rule: a cluster is ONE issue raised by N complainants, never N
  // issues. 53% of live student filings arrive as group submissions, so counting members as
  // issues would roughly double the "issues raised" figure and bury the real question — how
  // many DECISIONS need an answer.
  const grouped = audienceClusters
    .map(c => ({ cluster: c, stats: clusterStats(c.requests) }))
    .filter(g => g.stats.issues > 0);
  const groupedIssues = grouped.reduce((n, g) => n + g.stats.issues, 0);
  const groupedComplainants = grouped.reduce((n, g) => n + g.stats.complainants, 0);
  const groupedMessages = grouped.reduce((n, g) => n + g.cluster.requests.length, 0);

  const live = rows.filter(r => r.status === 'open' || r.status === 'waiting');
  const breached = live.filter(r => slaState({ dueAt: r.slaDueAt, firstReplyAt: r.firstReplyAt, now }) === 'breached');
  const noReply = rows.filter(r => !r.firstReplyAt && r.status !== 'unfiled' && r.status !== 'not_a_request');

  // The chase ladder (QM-D14): owed is DERIVED against `now`, never stored (QM-D15) — the
  // same chasesOwed() the queue's strip uses, over slightly different inputs: this page's
  // rows carry no aboutStaffIds exclusion (a count is not an audience) and no ?focus
  // switchboard filter, so a viewer who is the subject of a breached complaint — or one
  // hiding switchboard slips — can see a count here one higher than their own strip. Count
  // only, no content; the same shape as the pre-existing "past their target" stat.
  const lastChaseAt = new Map(
    rows.filter(r => r.chases.length > 0).map(r => [r.id, r.chases[0].openedAt]),
  );
  const owedNow = chasesOwed(rows, lastChaseAt, now).length;

  const perCampus = campuses.map(c => {
    const mine = rows.filter(r => r.campusOrgUnitId === c.id);
    const open = mine.filter(r => r.status === 'open' || r.status === 'waiting');
    return {
      campus: c,
      total: mine.length,
      open: open.length,
      unowned: open.filter(r => !r.ownerId).length,
      late: open.filter(r => slaState({ dueAt: r.slaDueAt, firstReplyAt: r.firstReplyAt, now }) === 'breached').length,
      resolved: mine.filter(r => r.status === 'resolved').length,
    };
  });

  // Repeat families — one in five came back, in the real corpus.
  const byFamily = new Map<string, { label: string; n: number }>();
  for (const r of rows) {
    if (!r.family) continue;
    const cur = byFamily.get(r.family.id) ?? { label: r.family.label, n: 0 };
    cur.n += 1;
    byFamily.set(r.family.id, cur);
  }
  const repeats = [...byFamily.values()].filter(f => f.n > 1).sort((a, b) => b.n - a.n);

  const byCategory = CATEGORIES
    .map(c => ({ def: c, n: rows.filter(r => (r.category ?? r.suggestedCategory) === c.key).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const maxCat = Math.max(1, ...byCategory.map(x => x.n));

  // Driven off CHANNELS so a new channel (like 'app', QM-D34) can never be silently
  // uncounted here — a hardcoded copy of the list is how that happens.
  const byChannel = CHANNELS
    .map(ch => ({ ch, n: rows.filter(r => r.channel === ch).length }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Quiet>{actor.scopeOrgUnitId === 'group' ? 'Group view — every campus' : 'Campus view'}</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">Oversight</h1>
        <p className="text-sm text-muted mt-2 max-w-[70ch]">
          Every measure here is about <strong>requests</strong> — what is open, late, or repeating.
          Nobody is scored. The purpose is to find where the system fails, not who to blame.
        </p>
      </div>

      <div className="fh-tabs">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={t.key === 'overview' ? '/oversight' : `/oversight?tab=${t.key}`}
            className={`fh-tab${tab === t.key ? ' is-active' : ''}`}
            aria-selected={tab === t.key}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'overview' && (
      <>
      {/* Feedback #30 — VK's verdict on this page was "I don't think anything is happening
          here". These two panels are the answer he asked for: where the system is failing, and
          what families are actually asking about. The stat tiles below stay — they were never
          wrong, only insufficient. */}
      <WhereItIsFailing
        health={health}
        ageing={ageing}
        medianDays={medianDays}
        chasesOwed={owedNow}
      />

      <WhatFamiliesAsk demand={demand} rising={rising} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={live.length} label="open right now" tone="blue" />
        <Stat value={breached.length} label="past their target" tone={breached.length ? 'deepred' : 'green'} />
        <Stat value={noReply.length} label="filed with no reply yet" tone={noReply.length ? 'rust' : 'green'} />
        <Stat value={repeats.length} label="families who came back" tone="plum" />
      </div>

      {/* QM-D14: chase volume is reported from DAY ONE, and framed as a diagnostic — every
          chase means classification, ownership and the response clock all failed to move
          someone first. Framing it as desk workload would invite fixing the desk, which is
          the one part of the ladder that worked. */}
      <section className="flex flex-col gap-3">
        <SectionTitle note="A chase is the desk's 'find the owner' act on a breached item — a diagnostic, not a workload.">
          Chase ladder <NewBadge />
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 max-w-[440px]">
          <Stat value={owedNow} label="owed a chase right now" tone={owedNow ? 'deepred' : 'green'} />
          <Stat value={chasedLast7} label="chased in the last 7 days" tone={chasedLast7 ? 'rust' : 'green'} />
        </div>
        <p className="text-sm text-muted max-w-[70ch]">
          A rising chase count is evidence the earlier rungs are failing — not desk workload.
        </p>
      </section>
      </>
      )}

      {tab === 'campus' && (
      <section className="flex flex-col gap-3">
        <SectionTitle note="Same system, one row per campus — no rebuild when the next joins.">
          By campus
        </SectionTitle>
        <div className="fh-table-wrap">
          <table className="fh-table">
            <thead>
              <tr className="text-left">
                {['Campus', 'Total', 'Open', 'No owner', 'Late', 'Resolved'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perCampus.map(p => (
                <tr key={p.campus.id}>
                  <td>
                    <strong>{p.campus.code.toUpperCase()}</strong>
                    <span className="text-subtle text-xs"> · {p.campus.name}</span>
                  </td>
                  <td className="tabular-nums">{p.total}</td>
                  <td className="tabular-nums font-semibold">{p.open}</td>
                  <td className={`tabular-nums ${p.unowned ? 'text-danger font-semibold' : 'text-subtle'}`}>{p.unowned}</td>
                  <td className={`tabular-nums ${p.late ? 'text-danger font-semibold' : 'text-subtle'}`}>{p.late}</td>
                  <td className="tabular-nums text-muted">{p.resolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {tab === 'overview' && grouped.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle note="A cluster is one issue raised by many families — never counted as many issues.">
            Group submissions
          </SectionTitle>
          <Card className="p-4" stripe="high">
            <div className="flex items-center gap-2 flex-wrap">
              <NewBadge />
              <p className="text-sm text-foreground">
                <strong>{groupedIssues}</strong> issue{groupedIssues === 1 ? '' : 's'} raised by{' '}
                <strong>{groupedComplainants}</strong> complainant{groupedComplainants === 1 ? '' : 's'}{' '}
                across <strong>{groupedMessages}</strong> messages — counted as {groupedIssues},
                not {groupedMessages}.
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {grouped.map(({ cluster: c, stats }) => (
                <div key={c.id} className="flex items-center gap-3 flex-wrap text-sm bg-surface-sunken/60 rounded px-3 py-1.5">
                  <span className="flex-1 min-w-[220px]">{c.label}</span>
                  <Quiet>
                    one issue · {stats.complainants} complainant{stats.complainants === 1 ? '' : 's'} · {c.requests.length} messages
                  </Quiet>
                </div>
              ))}
            </div>
            {/* QM-D19: the single count above is for reporting, never for handling. */}
            <p className="text-xs text-subtle mt-3">
              Each family still keeps its own record, status and satisfaction — the single count
              is for reporting, not for handling.
            </p>
          </Card>
        </section>
      )}

      {tab === 'categories' && (
        <section className="flex flex-col gap-3">
          <SectionTitle note="The thing worth fixing at source.">What parents write about</SectionTitle>
          <Card className="p-4" stripe="normal">
            <div className="flex flex-col gap-2">
              {byCategory.map(({ def, n }) => (
                <div key={def.key} className="grid grid-cols-[minmax(120px,180px)_1fr_auto] gap-3 items-center">
                  <span className="text-xs text-muted truncate">{def.label}</span>
                  <div className="h-4 rounded bg-surface-sunken overflow-hidden">
                    <div className="h-full rounded bg-primary" style={{ width: `${(n / maxCat) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold tabular-nums w-6 text-right">{n}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {tab === 'channels' && (
        <section className="flex flex-col gap-3">
          <SectionTitle note="Seven doors, one room.">How it arrived</SectionTitle>
          <Card className="p-4" stripe="normal">
            <div className="grid grid-cols-3 gap-3">
              {byChannel.map(({ ch, n }) => (
                <div key={ch} className="rounded-md bg-surface-sunken px-3 py-2">
                  <div className="font-heading text-2xl font-semibold tabular-nums">{n}</div>
                  {/* CHANNEL_LABEL, not `capitalize` — that rendered "Whatsapp". */}
                  <div className="text-xs text-muted">{CHANNEL_LABEL[ch as Channel] ?? ch}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-subtle mt-3">
              Calls, walk-ins and WhatsApp are only here because someone logged them. Before this,
              their count was zero — not because they did not happen.
            </p>
          </Card>
        </section>
      )}

      {tab === 'overview' && repeats.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle note="A second contact from the same family usually means the first was not resolved.">
            Families who came back
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            {repeats.map(f => (
              <span key={f.label} className="rounded-full bg-surface border border-border shadow-fh-sm px-3 py-1.5 text-xs">
                {f.label} · <strong>{f.n}</strong>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
