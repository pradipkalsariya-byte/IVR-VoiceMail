import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { rulesClassifier } from '@/core/classify';
import { modelConfigFromEnv, buildPayload } from '@/core/classify-model';
import { knownNameMatcher } from './name-dictionary';
import { RECORDS_BEGIN_AT } from '@/core/queue-window';
import { draftPrompt, parseDraft, rehydrate, shouldDraft } from '@/core/draft-reply';

// The database half of feedback #13b. core/draft-reply.ts holds every rule; this fetches, calls
// and stores.
//
// Only FILED requests are candidates. That is not a limitation, it is the point: shouldDraft()
// needs a category to decide whether a draft is appropriate at all, and "a human has filed it"
// is exactly the moment the desk has decided this is real work someone will answer.
//
// Note what this does NOT touch: the reply path. The app really can send (in-app always, email
// when the thread supports it), so a draft is written to its own column and read by a person.
// Nothing here calls reply(), and nothing here fills the reply box.

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 20_000;

export interface DraftSummary {
  considered: number;
  drafted: number;
  refused: number;
  errors: string[];
}

/** "Parents of Aarav Shah" -> "Aarav Shah". Returns null when the label is not that shape. */
export function childFromLabel(label: string | null | undefined): string | null {
  const stripped = (label ?? '').replace(/^\s*parents?\s+of\b\s*/i, '').trim();
  if (!stripped || /^family\s+\d+$/i.test(stripped)) return null;
  return stripped;
}

export async function draftReplies(limit = 10): Promise<DraftSummary> {
  const summary: DraftSummary = { considered: 0, drafted: 0, refused: 0, errors: [] };

  const cfg = modelConfigFromEnv(rulesClassifier);
  if (!cfg.apiKey) {
    summary.errors.push('ANTHROPIC_API_KEY is not set, so nothing was drafted.');
    return summary;
  }

  const rows = await db.request.findMany({
    where: {
      category: { not: null },        // a human has filed it
      firstReplyAt: null,             // and nobody has answered yet
      draftReply: null,               // and we have not already offered one
      status: { in: ['open', 'waiting'] },
      arrivedAt: { gte: RECORDS_BEGIN_AT },
    },
    select: {
      id: true, subject: true, body: true, category: true,
      owner: { select: { name: true } },
      family: { select: { label: true } },
    },
    orderBy: { arrivedAt: 'desc' },
    take: limit,
  });

  const matcher = (await knownNameMatcher()).matcher;

  for (const r of rows) {
    summary.considered++;

    const decision = shouldDraft(r.category);
    if (!decision.draft) { summary.refused++; continue; }

    // The SAME redaction path the classifier uses, refusal included. A draft is not a reason to
    // relax it — if anything the risk is higher, because this text is written to be sent back.
    const built = buildPayload({ subject: r.subject ?? '', body: r.body ?? '' }, matcher);
    if ('refused' in built) { summary.refused++; continue; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: draftPrompt(built.payload.subject, built.payload.body, {
              category: r.category as string,
              ownerName: r.owner?.name ?? null,
            }),
          }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) { summary.errors.push(`${r.id}: model answered ${res.status}`); continue; }

      const j = (await res.json()) as { content?: Array<{ text?: string }> };
      const draft = parseDraft(j.content?.[0]?.text ?? '');
      if (!draft) { summary.errors.push(`${r.id}: unusable draft`); continue; }

      // The names go back in HERE, from our own database. The API wrote «child»; the desk reads
      // the child's name; the two never meet.
      const text = rehydrate(draft, { child: childFromLabel(r.family?.label), parent: null });

      await db.request.update({
        where: { id: r.id },
        data: { draftReply: text, draftReplyAt: new Date() },
      });
      await db.activity.create({
        data: {
          id: randomUUID(), requestId: r.id, at: new Date(), kind: 'note',
          detail: 'A suggested reply was drafted. Nobody has sent it — it is there to edit.',
        },
      });
      summary.drafted++;
    } catch (e) {
      const why = e instanceof Error && e.name === 'AbortError'
        ? 'the model did not answer in time' : e instanceof Error ? e.message : String(e);
      summary.errors.push(`${r.id}: ${why}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return summary;
}
