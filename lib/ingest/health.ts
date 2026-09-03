import 'server-only';
import { db } from '@/lib/db';
import {
  automationWanted, DEDUPE_ASSURANCE, filterSet, HEALTH_LABEL, HEALTH_TONE, healthSentence,
  mailboxHealthState, type MailboxHealthState,
} from '@/core/mailboxHealth';
import { formatInstantShortIST } from '@/core/dates';
import { getMailSource } from './run';

// lib/ingest/health.ts — assembles the facts core/mailboxHealth.ts decides on, and the
// display strings the Mailbox page and the queue strip render. One read model, two surfaces,
// so the strip can never tell a different story from the card (recruitment's 23-Aug lesson:
// the same health sentence on three screens drifted; one home, others link).

export interface MailboxHealthView {
  state: MailboxHealthState;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'outline';
  sentence: string;
  dedupeAssurance: string;
  /** The most recent pass of any trigger, for the "last pulled" fact — null if none ever. */
  lastRun: {
    at: string;
    trigger: string;
    byName: string | null;
    ok: boolean;
    fetched: number;
    created: number;
    appended: number;
    parked: number;
    firstError: string | null;
  } | null;
  /** True when the pull button should explain that the source is not live. */
  sourceName: string;
  sourceReady: boolean;
  sourceReadyReason: string;
}

export async function readMailboxHealth(now = new Date()): Promise<MailboxHealthView> {
  const source = getMailSource();
  const gate = await source.isReady();

  const [lastTick, lastOkRun, lastRun] = await Promise.all([
    db.ingestRun.findFirst({
      where: { trigger: 'tick' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, finishedAt: true, ok: true },
    }),
    db.ingestRun.findFirst({
      where: { ok: true },
      orderBy: { startedAt: 'desc' },
      select: { finishedAt: true, startedAt: true },
    }),
    db.ingestRun.findFirst({
      orderBy: { startedAt: 'desc' },
      include: { actor: { select: { name: true } } },
    }),
  ]);

  const state = mailboxHealthState({
    source: source.name,
    automationWanted: automationWanted(process.env),
    filterSet: filterSet(process.env),
    lastTick,
    lastOk: lastOkRun ? { finishedAt: lastOkRun.finishedAt ?? lastOkRun.startedAt } : null,
    now,
  });

  const lastOkText = lastOkRun
    ? formatInstantShortIST(lastOkRun.finishedAt ?? lastOkRun.startedAt)
    : null;

  return {
    state,
    label: HEALTH_LABEL[state],
    tone: HEALTH_TONE[state],
    sentence: healthSentence(state, lastOkText),
    dedupeAssurance: DEDUPE_ASSURANCE,
    lastRun: lastRun
      ? {
          at: formatInstantShortIST(lastRun.startedAt),
          trigger: lastRun.trigger,
          byName: lastRun.actor?.name ?? null,
          ok: lastRun.ok,
          fetched: lastRun.fetched,
          created: lastRun.created,
          appended: lastRun.appended,
          parked: lastRun.parked,
          firstError: lastRun.errors[0] ?? null,
        }
      : null,
    sourceName: source.name,
    sourceReady: gate.ready,
    sourceReadyReason: gate.reason,
  };
}
