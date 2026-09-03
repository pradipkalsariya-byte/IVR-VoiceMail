// core/draft-reply.ts — a reply the desk can edit and send. Never one that sends itself.
//
// Feedback #13b, 26-Aug-2026: "same deep learning need to draft automated replies wherever
// needed". "Wherever needed" is doing real work in that sentence, and most of this file is
// about where a draft is NOT needed — because the cost of a wrong draft is not a wasted
// keystroke, it is a parent receiving a form letter about their child being humiliated.
//
// Three rules, in order of how much they matter:
//
//   1. NOBODY SENDS THIS BUT A PERSON. The app CAN send -- in-app to any family, and a real
//      email reply when the request arrived by email and the family has an address on record
//      (core/app-rail.ts's canSendEmailReply). That is exactly why this file is careful: a
//      draft that could reach the reply box automatically is one keystroke from being a system
//      that answers parents by itself. It never lands in the box. It sits beside it, as text,
//      and a person decides what to do with it (AI-13).
//   2. SOME MAIL MUST NOT BE DRAFTED FOR. Safeguarding and complaints about a named member of
//      staff are answered by a person who has read them, or they are answered badly. A refusal
//      here is a feature; see REFUSE_TO_DRAFT.
//   3. A DRAFT MAY NOT INVENT. The desk does not know the fee balance, the bus timing or the
//      decision when the mail arrives, and neither does the model. A draft acknowledges, says
//      what happens next, and names who is picking it up. That is the honest scope of a front
//      desk reply, and it is most of what a parent wants within the hour.
//
// The child's name never travels. The model writes «child» and core/draft-reply.ts's own
// rehydrate() puts the real name back HERE, from the database, after the answer comes home —
// so the desk reads "Dear Mr Shah, Aarav's exit pass…" while the API saw neither name.
//
// PURE. The DB half is lib/draft-reply.ts.

import { isSafeguardingCategory } from './taxonomy';

/**
 * Categories a draft is never offered for.
 *
 * `child-safety` is the obvious one and is checked by taxonomy flag rather than by name, so a
 * new safeguarding category inherits the refusal instead of quietly missing it.
 *
 * `about-other-parent` and `selection` join it for the QM-D32/D33 reason: both are routinely
 * complaints ABOUT a named person, where anything that reads as pre-written confirms the
 * family's fear that nobody actually read it.
 *
 * `not-a-request` is here for the opposite reason — there is nobody to reply to.
 */
export const REFUSE_TO_DRAFT = new Set([
  'child-safety', 'about-other-parent', 'selection', 'not-a-request', 'unclassified',
]);

export interface DraftDecision {
  draft: boolean;
  /** Always set. Shown to the desk, so it explains rather than just declines. */
  reason: string;
}

/** Should this request get a drafted reply at all? */
export function shouldDraft(category: string | null | undefined): DraftDecision {
  if (!category) {
    return { draft: false, reason: 'Nobody has filed this yet, so there is nothing to reply about.' };
  }
  if (isSafeguardingCategory(category)) {
    return {
      draft: false,
      reason: 'Safeguarding. This one is answered by a person who has read it — a drafted reply '
        + 'would read as a form letter at the worst possible moment.',
    };
  }
  if (REFUSE_TO_DRAFT.has(category)) {
    return {
      draft: false,
      reason: 'This category is answered personally: it is usually about a named person, and '
        + 'anything pre-written confirms the fear that nobody read it.',
    };
  }
  return { draft: true, reason: 'A routine acknowledgement is useful here.' };
}

export interface DraftContext {
  /** The filed category. */
  category: string;
  /** Who will pick it up, if anyone is assigned. Shown so the parent knows who has it. */
  ownerName?: string | null;
  /** How long the desk has committed to replying in, in working hours. */
  targetHours?: number | null;
}

export function draftPrompt(
  redactedSubject: string, redactedBody: string, ctx: DraftContext,
): string {
  return [
    'You are drafting a short reply for a school front desk to send to a parent.',
    'A member of the desk staff will read your draft, edit it, and send it themselves.',
    '',
    'The text you are shown has been redacted. «child», «name», «phone», «email», «grade» and',
    '«id» are placeholders for removed personal details.',
    '',
    'Write the reply using «child» wherever the child should be named. Do not invent a name.',
    '',
    'RULES:',
    '- Do NOT promise anything specific: no amounts, no dates, no times, no decisions, no',
    '  approvals. You do not know them and neither does the person sending this.',
    '- Do acknowledge what they actually asked, in your own words, so it is obvious it was read.',
    '- Do say what happens next and who is picking it up.',
    '- Warm, plain, and short. Four sentences at most. No marketing language.',
    '- A blank line between paragraphs. You may use "- " for a bullet list and **bold**,',
    '  sparingly — the reply is sent as formatted email, so these render properly.',
    '- British spelling. No exclamation marks.',
    '- Do not apologise unless the parent described something going wrong.',
    '',
    ctx.ownerName ? `The person picking this up is ${ctx.ownerName}.` : 'Nobody is assigned yet, so say the desk will pick it up.',
    ctx.targetHours ? `The desk aims to reply properly within ${ctx.targetHours} working hours.` : '',
    '',
    'Answer with JSON only, in exactly this shape:',
    '{"body":"<the reply, plain text, \n between paragraphs>"}',
    '',
    '---',
    `Category: ${ctx.category}`,
    `Subject: ${redactedSubject || '(no subject)'}`,
    '',
    redactedBody || '(no body)',
  ].filter(Boolean).join('\n');
}

/** Parse and validate. A draft that arrives malformed is no draft, not a broken one. */
export function parseDraft(text: string): string | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: unknown;
  try { raw = JSON.parse(m[0]); } catch { return null; }
  const body = (raw as { body?: unknown } | null)?.body;
  if (typeof body !== 'string') return null;
  const trimmed = body.trim();
  if (trimmed.length < 20) return null;      // not a reply
  if (trimmed.length > 1_500) return null;   // not a front desk reply
  return trimmed;
}

/**
 * Put the real names back, locally, after the model has answered.
 *
 * This is the whole reason the model can be given a redacted message and still produce a draft
 * somebody would actually send. The API sees «child»; the desk sees the child's name; the two
 * never meet.
 *
 * A missing name is left as the placeholder rather than guessed at or blanked — a desk
 * assistant seeing «child» in a draft knows to fill it in, whereas an empty space reads as a
 * finished sentence.
 */
export function rehydrate(
  draft: string, names: { child?: string | null; parent?: string | null },
): string {
  let out = draft;
  if (names.child) out = out.split('«child»').join(names.child);
  if (names.parent) out = out.split('«name»').join(names.parent);
  return out;
}

/** True when a draft still carries an unfilled placeholder the desk must complete. */
export function hasPlaceholders(draft: string): boolean {
  return /«[a-z-]+»/i.test(draft);
}
