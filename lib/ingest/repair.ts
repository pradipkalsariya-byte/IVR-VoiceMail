import 'server-only';
import { db } from '@/lib/db';
import { GmailMailSource } from './gmail';
import { getMailSource } from './run';

// lib/ingest/repair.ts — provenance self-heal (2026-08-24, the production review's find).
//
// The 12-Aug live pull predated the senderEmail column, so every historical request and
// ledger row rendered "Sender not identified" with an empty FROM column — the exact facts
// this round exists to show. Rather than a one-off script run from a laptop (which would
// need the mailbox token outside the deployment), the deployed app heals itself: each
// ingestion pass tops up a capped batch of provenance-less ledger rows by re-reading ONLY
// the headers of their threads, and copies the facts onto the linked requests. Idempotent
// by shape — a healed row has fromEmail set and leaves the queue for good; ~84 rows heal
// within a handful of five-minute ticks.
//
// FILL-ONLY, never overwrite: a request that already carries provenance (everything ingested
// after the column landed) is never touched — live ingestion remains the record of truth.

export interface RepairReport {
  examined: number;
  repaired: number;
  requestsFilled: number;
  errors: string[];
}

export async function repairLedgerProvenance(limit = 25): Promise<RepairReport> {
  const report: RepairReport = { examined: 0, repaired: 0, requestsFilled: 0, errors: [] };

  const source = getMailSource();
  if (!(source instanceof GmailMailSource)) return report;

  const entries = await db.mailLedgerEntry.findMany({
    where: { fromEmail: null, source: 'gmail', threadId: { not: null } },
    orderBy: { processedAt: 'desc' },
    take: limit,
    select: { id: true, messageId: true, threadId: true, recipients: true, requestId: true },
  });
  report.examined = entries.length;
  if (entries.length === 0) return report;

  // One thread often carries several ledger mails — fetch each thread's headers once.
  const byThread = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byThread.get(e.threadId!) ?? [];
    list.push(e);
    byThread.set(e.threadId!, list);
  }

  for (const [threadId, list] of byThread) {
    let headers: Awaited<ReturnType<GmailMailSource['threadHeaders']>>;
    try {
      headers = await source.threadHeaders(threadId);
    } catch (e) {
      // One unreadable thread (deleted mail, transient 4xx) must not stop the rest — and it
      // stays in the queue for the next pass rather than being marked over.
      report.errors.push(`${threadId}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const entry of list) {
      const match = headers.find(h => h.messageId === entry.messageId);
      if (!match || !match.from.email) continue;
      try {
        await db.mailLedgerEntry.update({
          where: { id: entry.id },
          data: {
            fromName: match.from.name || null,
            fromEmail: match.from.email,
            ...(entry.recipients.length === 0 && match.recipients.length > 0
              ? { recipients: match.recipients }
              : {}),
          },
        });
        report.repaired++;
        if (entry.requestId) {
          // Fill-only on the request too: senderEmail where null, recipients where empty.
          const filled = await db.request.updateMany({
            where: { id: entry.requestId, senderEmail: null },
            data: { senderEmail: match.from.email },
          });
          if (match.recipients.length > 0) {
            await db.request.updateMany({
              where: { id: entry.requestId, originalRecipients: { isEmpty: true } },
              data: { originalRecipients: match.recipients },
            });
          }
          report.requestsFilled += filled.count;
        }
      } catch (e) {
        report.errors.push(`${entry.messageId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return report;
}
