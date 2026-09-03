// core/classify-model.ts — the model-backed classifier, behind the same seam as the rules one.
//
// Feedback #13a, 26-Aug-2026: "you need to do deep learning to make sure that the emails and
// their content match the categories". The rules pass got a long way (praise 36 -> 1,
// leave-medical 17 -> 45), but regexes cannot tell a complaint from a query, and that is the
// judgement the desk actually wants.
//
// VK cleared the DPDP gate on 26-Aug with one condition, stated in his own words: "to train on
// all the old emails WITHOUT USING THE NAMES ITSELF, and to draft replies". That condition is
// engineered here, not promised:
//
//   1. Subject and body are REDACTED before the prompt is built, using core/redact.ts — the
//      same implementation the archive reports have used since August, not a second copy.
//   2. The redacted text is then CHECKED with residualPii(). If anything got through, the
//      request is ABANDONED and the rules classifier answers instead. It is better to be less
//      accurate than to send a child's name somewhere it was not cleared to go.
//   3. Nothing else about the message travels — no sender address, no recipients, no thread id,
//      no reference. The model sees prose and a category list.
//
// Fails back to rules on ANY failure — network, timeout, malformed answer, unknown category.
// A classifier that goes down must degrade to a worse suggestion, never to no queue at all.

import { redactBody, redactSubject, residualPersonalData } from './redact';
import { maskKnownNames } from './name-dictionary';
// TYPE-ONLY, and that is load-bearing: core/classify.ts statically imports this module to
// register the 'model' provider, so a value import back would be a runtime cycle. The fallback
// classifier arrives through config instead — which also makes the fallback testable.
import type { Classifier, ClassifyInput, Suggestion } from './classify';
import { CATEGORIES, isSafeguardingCategory, URGENCIES, type Urgency } from './taxonomy';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';
const TIMEOUT_MS = 12_000;
/** Bodies are truncated before sending: the tail of a long thread is quoted history. */
const MAX_BODY_CHARS = 4_000;

export interface ModelClassifierConfig {
  apiKey?: string;
  model?: string;
  /** Injectable for tests — no network in the suite. */
  fetchImpl?: typeof fetch;
  /**
   * Supplies the known-name matcher, re-read per request so a newly enrolled student is masked
   * without a restart. Async because the names come from the database; a null return (or a
   * throw) means no dictionary, and buildPayload then falls back to pattern redaction alone.
   *
   * A FUNCTION rather than a value because this config is built once at startup, and a matcher
   * captured then would be frozen at the roster as it stood that morning.
   */
  knownNames?: () => Promise<RegExp | null>;
  /**
   * Who answers when the model cannot — not configured, refused by redaction, down, slow, or
   * talking nonsense. Required, because every one of those paths is reachable in normal
   * operation and none of them may end with the desk getting no suggestion at all.
   */
  fallback: Classifier;
}

export function modelConfigFromEnv(
  fallback: Classifier,
  env: Record<string, string | undefined> = process.env,
): ModelClassifierConfig {
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || DEFAULT_MODEL, fallback };
}

/** What actually leaves this machine. Exported so it can be shown to a person, and tested. */
export interface Payload {
  subject: string;
  body: string;
}

/**
 * Build the redacted payload, or refuse.
 *
 * Returns null when redaction left something identifiable behind — the caller must then fall
 * back rather than send. Refusing is the whole point: a redactor that quietly passes what it
 * could not clean is worse than none, because it looks like a safeguard.
 */
export function buildPayload(
  input: ClassifyInput,
  /**
   * A matcher over every name the school holds — students and staff — built by
   * lib/name-dictionary.ts and cached. This is the primary defence, not a supplement: the
   * 26-Aug audit found that every name surviving pattern-based redaction belonged to somebody
   * already in our own database. Knowing the names beats guessing their shape, and it stops
   * over-redaction eating real words ("Morker drop") out of the text the classifier needs.
   */
  knownNameMatcher: RegExp | null = null,
): { payload: Payload } | { refused: string } {
  const subject = maskKnownNames(redactBody(redactSubject(input.subject ?? '')), knownNameMatcher);
  const body = maskKnownNames(
    redactBody((input.body ?? '').slice(0, MAX_BODY_CHARS)), knownNameMatcher,
  );

  const leaked = [...residualPersonalData(subject), ...residualPersonalData(body)];
  if (leaked.length > 0) {
    return {
      refused:
        `Redaction left ${leaked.length} identifiable value${leaked.length === 1 ? '' : 's'} ` +
        'in the text, so it was not sent. Classified by rules instead.',
    };
  }
  return { payload: { subject, body } };
}

const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

function prompt(p: Payload): string {
  const list = CATEGORIES.map(c => `- ${c.key}: ${c.label}`).join('\n');
  return [
    'You are helping a school front desk sort incoming parent messages.',
    'The text has been redacted: «email», «phone», «name», «child», «grade» and «id» are',
    'placeholders for removed personal details. Do not comment on them.',
    '',
    'Choose ONE category from this list, and an urgency.',
    '',
    list,
    '',
    'Urgency must be one of: low, normal, high, critical.',
    'Use critical ONLY where a child may be unsafe.',
    '',
    'Answer with JSON only, no prose, in exactly this shape:',
    '{"category":"<key>","urgency":"<level>","reason":"<one short sentence, plain language>"}',
    '',
    'The reason is shown to a desk assistant beside your suggestion, so write it for them:',
    'say what in the message led you there. Never mention JSON, categories-as-keys, or yourself.',
    '',
    '---',
    `Subject: ${p.subject || '(no subject)'}`,
    '',
    p.body || '(no body)',
  ].join('\n');
}

interface ModelAnswer {
  category: string;
  urgency: string;
  reason: string;
}

/** Parse and VALIDATE. An unrecognised category is a failure, not something to store. */
export function parseAnswer(text: string): ModelAnswer | null {
  // The model is asked for bare JSON, but a stray code fence should not cost a classification.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: unknown;
  try { raw = JSON.parse(m[0]); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;

  const o = raw as Record<string, unknown>;
  const category = typeof o.category === 'string' ? o.category.trim() : '';
  const urgency = typeof o.urgency === 'string' ? o.urgency.trim().toLowerCase() : '';
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';

  if (!CATEGORY_KEYS.includes(category)) return null;
  if (!URGENCIES.includes(urgency as Urgency)) return null;
  if (!reason) return null;
  return { category, urgency, reason };
}

export function makeModelClassifier(cfg: ModelClassifierConfig): Classifier & {
  classifyAsync(input: ClassifyInput): Promise<Suggestion>;
} {
  const doFetch = cfg.fetchImpl ?? fetch;

  return {
    name: 'model',

    /**
     * The synchronous seam still answers from rules.
     *
     * The Classifier interface is synchronous and every existing caller depends on that. Rather
     * than make the whole ingest path async for one provider, the model runs through
     * classifyAsync and callers that can await it do; anything that cannot still gets a
     * suggestion. Deliberate, and the reason it is safe: rules is a real answer, not a stub.
     */
    classify(input: ClassifyInput): Suggestion {
      return cfg.fallback.classify(input);
    },

    async classifyAsync(input: ClassifyInput): Promise<Suggestion> {
      const fallback = (why: string): Suggestion => {
        const r = cfg.fallback.classify(input);
        return { ...r, reason: `${r.reason} (${why})` };
      };

      if (!cfg.apiKey) return fallback('the model is not configured');

      // A dictionary failure must not become a redaction failure: if the names cannot be read,
      // buildPayload still runs its pattern pass and its residual check, and refuses on its own
      // terms. Falling back to "send it unmasked" would be the one unsafe direction.
      let matcher: RegExp | null = null;
      try { matcher = cfg.knownNames ? await cfg.knownNames() : null; } catch { matcher = null; }

      const built = buildPayload(input, matcher);
      if ('refused' in built) return fallback(built.refused);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await doFetch(API_URL, {
          method: 'POST',
          headers: {
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: cfg.model ?? DEFAULT_MODEL,
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt(built.payload) }],
          }),
          signal: controller.signal,
        });

        if (!res.ok) return fallback(`the model answered ${res.status}`);

        const j = (await res.json()) as { content?: Array<{ text?: string }> };
        const answer = parseAnswer(j.content?.[0]?.text ?? '');
        if (!answer) return fallback('the model did not answer in a usable shape');

        return {
          category: answer.category,
          urgency: answer.urgency as Urgency,
          isVendorNoise: answer.category === 'not-a-request',
          isSafeguarding: isSafeguardingCategory(answer.category),
          // Never 'high'. The confidence field drives whether a person must read something, and
          // a model's fluency is not evidence — it is exactly as sure of a wrong answer.
          confidence: 'low',
          reason: answer.reason,
        };
      } catch (e) {
        const why = e instanceof Error && e.name === 'AbortError'
          ? 'the model did not answer in time'
          : 'the model could not be reached';
        return fallback(why);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
