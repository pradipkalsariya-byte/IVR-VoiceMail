import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { rulesClassifier } from '@/core/classify';
import { makeModelClassifier, modelConfigFromEnv } from '@/core/classify-model';
import { machineFamily } from '@/core/machine-mail';
import { knownNameMatcher } from './name-dictionary';
import { RECORDS_BEGIN_AT } from '@/core/queue-window';

// A second pass over the SUGGESTION only, using the model, for mail a person actually wrote.
//
// Why a separate pass rather than a step inside ingest: the model takes a second or two per
// message and can fail. Ingest's job is to get mail into the queue reliably, and it must not
// wait on — or be broken by — a classification refinement. So ingest stores the rules answer,
// which is a real answer, and this improves it afterwards. If it never runs, the queue is still
// correct, just less well sorted.
//
// Measured on the live queue, 26-Aug-2026 (280 emails since 01-Aug):
//
//   * 57% is template mail — exit passes, sickbay notices, calendar invitations, bank advice.
//     core/machine-mail.ts answers those from the subject shape, and it is SKIPPED here: it is
//     already right every time, the model was inconsistent on it (the same exit-pass shape came
//     back `leave-medical` six times and `not-a-request` nine times), and it would be the bulk
//     of the spend.
//   * 43% is prose. On 60 of those, rules and the model disagreed 19 times and the model was
//     the better answer in about 16 — rules had filed "Name update request" as fees, "ODAS
//     rescheduling" as praise, and "Silver medal" as not-a-request.
//
// So the split is not a cost compromise, it is where each one is actually better.

export interface RefineSummary {
  considered: number;
  refined: number;
  unchanged: number;
  skippedTemplate: number;
  errors: string[];
}

/**
 * Improve the suggestion on untriaged email.
 *
 * NEVER touches `category`. That field is a human's decision (AI-13 — the assistant suggests,
 * a person files), so a request somebody has already filed is not a candidate here at all, and
 * even for an untriaged one only `suggestedCategory`, `suggestionReason` and `urgency` move.
 */
export async function refineSuggestions(limit = 40): Promise<RefineSummary> {
  const summary: RefineSummary = {
    considered: 0, refined: 0, unchanged: 0, skippedTemplate: 0, errors: [],
  };

  const cfg = modelConfigFromEnv(rulesClassifier);
  if (!cfg.apiKey) {
    summary.errors.push('ANTHROPIC_API_KEY is not set, so nothing was refined.');
    return summary;
  }

  const rows = await db.request.findMany({
    where: {
      channel: 'email',
      category: null,                       // nobody has filed it yet
      arrivedAt: { gte: RECORDS_BEGIN_AT }, // the window the desk actually works
      modelClassifiedAt: null,              // and the model has not already answered
    },
    select: { id: true, subject: true, body: true, familyId: true, suggestedCategory: true },
    orderBy: { arrivedAt: 'desc' },
    take: limit,
  });

  const classifier = makeModelClassifier({
    ...cfg,
    knownNames: async () => (await knownNameMatcher()).matcher,
  });

  for (const r of rows) {
    summary.considered++;
    if (machineFamily(r.subject)) { summary.skippedTemplate++; continue; }

    try {
      const s = await classifier.classifyAsync({
        subject: r.subject ?? '',
        body: r.body ?? '',
        senderIsKnownFamily: Boolean(r.familyId),
      });

      // Stamped whatever the answer, so a message is not re-sent on every run. A fallback
      // answer is still an answer about this message; retrying it would spend money to get the
      // same rules result it already has.
      const data: Record<string, unknown> = { modelClassifiedAt: new Date() };
      const changed = s.category !== r.suggestedCategory;
      if (changed) {
        data.suggestedCategory = s.category;
        data.suggestionReason = s.reason;
        data.urgency = s.urgency;
      }

      await db.request.update({ where: { id: r.id }, data });

      if (changed) {
        summary.refined++;
        // An audit row, because a suggestion that changes under a desk assistant without
        // explanation is worse than one that was wrong from the start.
        await db.activity.create({
          data: {
            id: randomUUID(), requestId: r.id, at: new Date(), kind: 'classified',
            detail: `Re-read and suggested "${s.category}" instead of `
              + `"${r.suggestedCategory ?? 'nothing'}" — ${s.reason}`,
          },
        });
      } else {
        summary.unchanged++;
      }
    } catch (e) {
      summary.errors.push(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
