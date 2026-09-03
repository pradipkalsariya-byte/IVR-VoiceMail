import 'server-only';
import { automationWanted, filterSet, TICK_INTERVAL_MS } from '@/core/mailboxHealth';

// lib/ingest/schedule.ts — the five-minute mailbox timer (2026-08-24, the email-visibility
// round; the cadence itself lives in core/mailboxHealth.ts so the health copy and the timer
// cannot disagree). Started once per server process from instrumentation.ts.
//
// THREE conditions, all required, each fail-closed:
//   1. MAIL_SOURCE=gmail — the demo source must never tick: it FABRICATES a batch per pull,
//      so a timer would invent fictional parent mail every five minutes forever.
//   2. MAILBOX_AUTOMATION != 'off' — the runbook off-switch. Default is ON when the other
//      two hold, because an automation that defaults off is one nobody remembers to enable.
//   3. GMAIL_QUERY set — the filter that scopes reading to the desk group's mail
//      (deliveredto:frontdesk@…). The token belongs to an individual member mailbox, so an
//      unfiltered read would ingest that person's ENTIRE inbox. Armed-but-unfiltered
//      REFUSES and says so on the Mailbox page, rather than defaulting to everything.

// The gate predicates live in core/mailboxHealth.ts (pure, tested); this module binds them
// to the live environment and owns the timers.

/** First pass shortly after boot — a deploy must not buy a five-minute blind window
 *  (recruitment hit exactly this on 20-Aug); not zero, so a cold Prisma pool and the boot
 *  migration are out of the way first. */
const FIRST_PASS_DELAY_MS = 20_000;

// Set once the boot pass has run, so only that pass asks for a cluster reconcile.
let bootPassDone = false;

const STARTED_KEY = Symbol.for('front-desk.ingest.timerStarted');

/**
 * Idempotent: dev hot-reload re-evaluates modules, so the started flag lives on globalThis.
 * Timers are unref()'d — the timer must never be what keeps a dying process alive.
 */
export function startMailboxTimer(env: NodeJS.ProcessEnv = process.env): { started: boolean; reason: string } {
  const g = globalThis as Record<symbol, unknown>;
  if (g[STARTED_KEY]) return { started: false, reason: 'Timer already running in this process.' };

  if (!automationWanted(env)) {
    return {
      started: false,
      reason: env.MAIL_SOURCE === 'gmail'
        ? 'MAILBOX_AUTOMATION=off — the runbook off-switch is set.'
        : `MAIL_SOURCE=${env.MAIL_SOURCE ?? 'seed'} — only the real mailbox ticks; the demo source would fabricate mail every five minutes.`,
    };
  }
  if (!filterSet(env)) {
    return {
      started: false,
      reason: 'GMAIL_QUERY is not set — refusing to read an unfiltered member mailbox. Set the desk-mail filter to start the timer.',
    };
  }

  g[STARTED_KEY] = true;

  const pass = async () => {
    try {
      // Imported lazily so merely loading this module (health.ts imports it for the env
      // predicates) never drags the whole ingest pipeline into scope.
      const { runRecordedIngest } = await import('./recorded');
      const isFirst = !bootPassDone;
      bootPassDone = true;
      await runRecordedIngest({ trigger: 'tick', actorId: null, firstPassAfterBoot: isFirst });
    } catch (e) {
      // runRecordedIngest records its own failures; this catch is only for "could not even
      // start a pass". Log and keep ticking — one bad pass must not kill the timer.
      console.error('[mailbox tick] pass failed to start:', e instanceof Error ? e.message : e);
    }
  };

  setTimeout(pass, FIRST_PASS_DELAY_MS).unref?.();
  setInterval(pass, TICK_INTERVAL_MS).unref?.();
  console.log(`[mailbox tick] started — every ${TICK_INTERVAL_MS / 60_000} min, first pass in ${FIRST_PASS_DELAY_MS / 1000}s.`);
  return { started: true, reason: 'Timer started.' };
}
