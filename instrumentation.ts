// instrumentation.ts — Next's once-per-server-start hook, used to start the five-minute
// mailbox timer (2026-08-24). Guarded to the node runtime: register() is also evaluated for
// the edge bundle (middleware), where timers and Prisma do not exist.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMailboxTimer } = await import('./lib/ingest/schedule');
    const r = startMailboxTimer();
    if (!r.started) console.log(`[mailbox tick] not started — ${r.reason}`);
  }
}
