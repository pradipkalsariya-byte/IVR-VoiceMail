// core/mailboxHealth.ts — the mailbox trust line, as a pure state machine (2026-08-24, the
// email-visibility round). PURE: no I/O, no clock reads — `now` comes in as an argument.
//
// The question this answers is the one VK's review found unanswerable on screen: "is
// everything sent to the desk mailbox actually IN here?" Recruitment's MailboxHealthCard
// (22-Aug) established the estate shape — a small closed set of states, each rendered as a
// full sentence a non-engineer can act on. Front-desk's states differ from recruitment's
// because its mechanics differ: there is a demo source, and automation fails CLOSED without
// an explicit mailbox filter (GMAIL_QUERY) — reading an unfiltered member mailbox would
// ingest the member's whole personal inbox, so "armed but unfiltered" is its own state, not
// a silent fallthrough.

/** What the health machine needs to know. All facts, no environment reads. */
export interface MailboxFacts {
  /** The active mail source's name — 'demo' | 'gmail' (MailSource.name). */
  source: string;
  /** MAILBOX_AUTOMATION !== 'off' — the operator's intent that the timer should run. */
  automationWanted: boolean;
  /** GMAIL_QUERY is set — the filter that scopes ingestion to the desk group's mail. */
  filterSet: boolean;
  /** The latest tick run of any outcome, if one exists. */
  lastTick: { startedAt: Date; finishedAt: Date | null; ok: boolean } | null;
  /** The latest SUCCESSFUL run of any trigger (pull or tick) — the freshness fact. */
  lastOk: { finishedAt: Date } | null;
  now: Date;
}

export type MailboxHealthState =
  | 'demo'        // not reading any real mailbox at all
  | 'manual'      // real mailbox, but only when someone pulls
  | 'unfiltered'  // automation wanted, but no GMAIL_QUERY — refused, loudly
  | 'starting'    // automation armed, first tick has not completed yet
  | 'healthy'     // ticking, last pass succeeded recently
  | 'down';       // ticking should be happening and is failing or absent

/** The timer's cadence. Exported so the copy below and the scheduler cannot disagree. */
export const TICK_INTERVAL_MS = 5 * 60 * 1000;

/** The timer's first gate: only the real mailbox may tick — a ticking DEMO source would
 *  fabricate fictional parent mail every five minutes forever. MAILBOX_AUTOMATION=off is the
 *  runbook off-switch (exact word; anything else means on, so the automation cannot be
 *  disabled by a typo nobody notices). Env comes in as an argument — this file stays pure. */
export function automationWanted(env: Record<string, string | undefined>): boolean {
  return env.MAIL_SOURCE === 'gmail' && env.MAILBOX_AUTOMATION !== 'off';
}

/** The timer's second gate: a set, non-blank GMAIL_QUERY. The token belongs to an individual
 *  member mailbox, so an unfiltered read would ingest that person's ENTIRE inbox — unset or
 *  blank must read as "no filter, refuse", never as "everything". */
export function filterSet(env: Record<string, string | undefined>): boolean {
  return Boolean(env.GMAIL_QUERY && env.GMAIL_QUERY.trim());
}

/** How stale the last success may be before 'healthy' becomes 'down': three missed slots. */
export const DOWN_AFTER_MS = 3 * TICK_INTERVAL_MS;

export function mailboxHealthState(f: MailboxFacts): MailboxHealthState {
  if (f.source !== 'gmail') return 'demo';
  if (!f.automationWanted) return 'manual';
  if (!f.filterSet) return 'unfiltered';
  if (!f.lastTick) return 'starting';
  const lastTickAt = (f.lastTick.finishedAt ?? f.lastTick.startedAt).getTime();
  const freshEnough = f.now.getTime() - lastTickAt <= DOWN_AFTER_MS;
  if (!freshEnough) return 'down';
  if (!f.lastTick.ok) return 'down';
  return 'healthy';
}

/** Badge text per state — the short form for the queue strip and the health card chip. */
export const HEALTH_LABEL: Record<MailboxHealthState, string> = {
  demo: 'Demo source',
  manual: 'Mailbox read on pull only',
  unfiltered: 'Automation refused — no filter',
  starting: 'First read pending',
  healthy: 'Mailbox up to date',
  down: 'Mailbox not being read',
};

/** DS badge tones, semantic vocabulary only. */
export const HEALTH_TONE: Record<MailboxHealthState, 'success' | 'warning' | 'danger' | 'outline'> = {
  demo: 'outline',
  manual: 'warning',
  unfiltered: 'danger',
  starting: 'outline',
  healthy: 'success',
  down: 'danger',
};

/**
 * The full sentence for the health card. `lastOkText` is the already-formatted instant of the
 * last successful pass (formatting is the caller's job — core does not own display locale).
 */
export function healthSentence(state: MailboxHealthState, lastOkText: string | null): string {
  switch (state) {
    case 'demo':
      return 'No real mailbox is read — the demo source fabricates a small batch when someone pulls.';
    case 'manual':
      return 'Nothing reads the mailbox on a timer — new mail arrives here only when someone presses Pull.'
        + (lastOkText ? ` Everything up to the ${lastOkText} pull is in.` : '');
    case 'unfiltered':
      return 'Automation is switched on but no mailbox filter (GMAIL_QUERY) is set, so it refuses to run — '
        + 'an unfiltered read would ingest the member mailbox’s entire inbox, not just desk mail. '
        + 'Set the filter to start the timer.';
    case 'starting':
      return 'Automation just started; the first mailbox read has not completed yet.';
    case 'healthy':
      return lastOkText
        ? `Everything sent to the desk mailbox up to ${lastOkText} is in this system — it is checked every five minutes.`
        : 'The mailbox is being checked every five minutes.';
    case 'down':
      return 'Reading has been failing'
        + (lastOkText ? ` — everything up to ${lastOkText} is in, nothing after it yet` : '')
        + '. New mail waits safely in the mailbox; the desk can keep working this queue meanwhile.';
  }
}

/** The standing dedupe assurance — true regardless of state, printed under every sentence.
 *  (Message-IDs are unique and replies join their thread; see lib/ingest/run.ts.) */
export const DEDUPE_ASSURANCE =
  'Pulling twice cannot duplicate anything: every message is keyed on its mail Message-ID, '
  + 'and a reply joins its existing request instead of opening a new one.';
