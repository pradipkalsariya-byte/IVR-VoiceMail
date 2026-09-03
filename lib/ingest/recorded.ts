import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { recomputeClustersDb } from '@/lib/clusters';
import { runIngest, type IngestSummary } from './run';

// lib/ingest/recorded.ts — every ingestion pass, on the record (2026-08-24, the
// email-visibility round). runIngest used to return its summary to one browser once; a
// minute later nobody could say when mail was last read or what the read did. Every pass —
// button or timer — now writes an IngestRun row, which is what the Mailbox page's health
// line and "recent passes" table read.
//
// SINGLE-FLIGHT, module-level. The five-minute timer and a human's Pull can land together,
// and a slow Gmail page can outlast the interval. Overlapping passes would race the
// Message-ID dedupe for every message in flight, so a second caller is refused with a
// reason rather than queued — a skipped pass costs five minutes; a doubled one costs
// duplicate requests. Guarded on globalThis because dev hot-reload re-evaluates modules.

const FLIGHT_KEY = Symbol.for('front-desk.ingest.inFlight');

type FlightStore = { inFlight: boolean };
const flight: FlightStore = ((globalThis as Record<symbol, unknown>)[FLIGHT_KEY] ??= { inFlight: false }) as FlightStore;

/** How far behind the last successful pass a new pass re-reads. Gmail's `after:` has day
 *  granularity and the dedupe absorbs overlap, so generous is free and under-fetching is the
 *  only real risk. */
const OVERLAP_MS = 6 * 60 * 60 * 1000;

export interface RecordedIngestResult {
  ran: boolean;
  /** Set when ran=false — why this pass did not run (another pass in flight). */
  reason?: string;
  runId?: string;
  summary?: IngestSummary;
}

export async function runRecordedIngest(opts: {
  trigger: 'pull' | 'tick';
  actorId: string | null;
  /** First pass after a restart — see the recompute note below. */
  firstPassAfterBoot?: boolean;
}): Promise<RecordedIngestResult> {
  if (flight.inFlight) {
    return { ran: false, reason: 'Another mailbox pass is already running — this one was skipped, not queued.' };
  }
  flight.inFlight = true;

  const runId = randomUUID();
  try {
    const lastOk = await db.ingestRun.findFirst({
      where: { ok: true },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });

    await db.ingestRun.create({
      data: {
        id: runId,
        startedAt: new Date(),
        trigger: opts.trigger,
        actorId: opts.actorId,
        source: process.env.MAIL_SOURCE === 'gmail' ? 'gmail' : 'demo',
        ok: false,
      },
    });

    const summary = await runIngest({
      since: lastOk ? new Date(+lastOk.startedAt - OVERLAP_MS) : undefined,
      limit: 100,
    });

    // "ok" means the PASS completed: the source was ready and the fetch did not throw.
    // Per-message failures are recorded in `errors` but do not fail the pass — one bad
    // message must never read as "mailbox down" while the other 99 landed fine. A fetch
    // that threw is distinguishable by shape: runIngest returns early with fetched=0 and
    // the throw as its only error; the per-message path cannot produce errors at fetched=0.
    const passOk = summary.ready && !(summary.fetched === 0 && summary.errors.length > 0);
    await db.ingestRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        ok: passOk,
        fetched: summary.fetched,
        created: summary.created,
        appended: summary.appended,
        skipped: summary.skipped,
        parked: summary.parked,
        // A not-ready gate is the row's one error — otherwise a "down" row would carry no
        // explanation at all.
        errors: summary.ready ? summary.errors.slice(0, 20) : [summary.readyReason, ...summary.errors].slice(0, 20),
      },
    });

    // Normally only new arrivals can change the cluster picture. But a DEPLOY changes it too,
    // because the clustering RULES live in code — and on 2026-08-25 that gap had teeth: the
    // distinct-originator rule shipped while every tick was fetching 100 and creating 0, so the
    // seven phantom "Looks coordinated" cards it was written to remove would have sat on the
    // live queue indefinitely — no UI anywhere triggers a recompute. The first pass after a
    // restart therefore reconciles stored clusters against the code that is actually running.
    if (summary.created > 0 || opts.firstPassAfterBoot) await recomputeClustersDb();

    // Once per deploy, not per tick. Re-reads mail an EARLIER classifier set aside and undoes
    // the one mistake that must never stand: a safeguarding message hidden as vendor mail.
    // Found live on production 27-Aug-2026 -- FD-0780, a parent alleging a staff member had
    // mocked her daughter, parked as marketing with no clock and no owner, in no staff list.
    //
    // Boot-scoped because it is a repair, not a routine: it is idempotent (a record it touches
    // is excluded next time), and running it every five minutes would re-read 200 bodies to
    // find nothing. Dry-run over 284 real records before shipping: it acted on 2, both genuine,
    // no false positives.
    if (opts.firstPassAfterBoot) {
      try {
        const { rescueSafeguarding } = await import('@/lib/rescue-safeguarding');
        const s = await rescueSafeguarding(300);
        if (s.unparked > 0 || s.flagged > 0 || s.errors.length > 0) {
          console.log(`[safeguarding rescue] examined ${s.examined}, brought back ${s.unparked}, flagged ${s.flagged}, clocks restored ${s.clocksRestored}${s.errors.length ? `, errors ${s.errors.length}` : ''}`);
        }
      } catch (e) {
        console.error('[safeguarding rescue] pass failed:', e instanceof Error ? e.message : e);
      }
    }

    // Feedback #20 — return untouched work to the pool. Rides the tick because it is the only
    // thing in the app that wakes up on its own; a failure here must never fail the mail pass,
    // which is why it is caught and logged rather than allowed to propagate.
    try {
      const { escalateStale } = await import('@/lib/assignment');
      const e = await escalateStale(new Date());
      if (e.escalated > 0) {
        console.log(`[escalation] returned ${e.escalated} of ${e.checked} owned requests to the pool.`);
      }
    } catch (err) {
      console.error('[escalation] pass failed:', err instanceof Error ? err.message : err);
    }

    // Provenance self-heal rides every pass (2026-08-24): tops up a capped batch of
    // history rows that predate the senderEmail column. Failure here never fails the pass —
    // the queue of unhealed rows simply waits for the next tick.
    try {
      const { repairLedgerProvenance } = await import('./repair');
      const r = await repairLedgerProvenance(25);
      if (r.repaired > 0 || r.errors.length > 0) {
        console.log(`[provenance repair] examined ${r.examined}, repaired ${r.repaired}, requests filled ${r.requestsFilled}${r.errors.length ? `, errors ${r.errors.length}` : ''}`);
      }
    } catch (e) {
      console.error('[provenance repair] pass failed:', e instanceof Error ? e.message : e);
    }

    // Feedback #13a -- the model re-reads mail a PERSON wrote and improves the suggestion.
    // Rides the tick for the same reason the two passes above do, and is caught for a stronger
    // one: this is the only pass that depends on a third-party API, so it is the likeliest to
    // fail and the least entitled to take the mail run down with it. Template mail is skipped
    // inside refineSuggestions -- rules already answer that correctly and for nothing.
    try {
      const { refineSuggestions } = await import('@/lib/refine');
      const r = await refineSuggestions(25);
      if (r.refined > 0 || r.errors.length > 0) {
        console.log(`[refine] read ${r.considered}, improved ${r.refined}, unchanged ${r.unchanged}, template skipped ${r.skippedTemplate}${r.errors.length ? `, errors ${r.errors.length}` : ''}`);
      }
    } catch (e) {
      console.error('[refine] pass failed:', e instanceof Error ? e.message : e);
    }

    // Feedback #13b -- offer a reply the desk can edit. Only for requests a human has already
    // FILED, and never for safeguarding (core/draft-reply.ts refuses those by taxonomy flag).
    // Nothing here sends anything. The app CAN send -- which is why the draft is written to
    // its own column and never into the reply box.
    try {
      const { draftReplies } = await import('@/lib/draft-reply');
      const d = await draftReplies(10);
      if (d.drafted > 0 || d.errors.length > 0) {
        console.log(`[draft] considered ${d.considered}, drafted ${d.drafted}, refused ${d.refused}${d.errors.length ? `, errors ${d.errors.length}` : ''}`);
      }
    } catch (e) {
      console.error('[draft] pass failed:', e instanceof Error ? e.message : e);
    }

    return { ran: true, runId, summary };
  } catch (e) {
    // The pass itself died (DB down, fetch threw before the loop). Best-effort record — if
    // even the update fails, the row stays ok=false with no finishedAt, which the health
    // machine already reads as "died mid-flight", not as silence.
    const message = e instanceof Error ? e.message : String(e);
    try {
      await db.ingestRun.update({
        where: { id: runId },
        data: { finishedAt: new Date(), ok: false, errors: [message] },
      });
    } catch { /* the row's missing finishedAt is itself the evidence */ }
    return { ran: true, runId, summary: {
      source: process.env.MAIL_SOURCE === 'gmail' ? 'gmail' : 'demo',
      ready: false, readyReason: message,
      fetched: 0, created: 0, appended: 0, skipped: 0, parked: 0, errors: [message],
    } };
  } finally {
    flight.inFlight = false;
  }
}
