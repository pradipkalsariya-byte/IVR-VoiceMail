// core/request-signal.ts — does this message actually ask for anything?
//
// Register #5, resolved by VK on 27-Aug-2026: internal staff mail should skip the queue "only
// when it carries no request; front desk decides."
//
// Both halves of that sentence are load-bearing, and this file is the first half.
//
// WHY IT IS NOT "PARK ALL INTERNAL MAIL". A colleague forwarding a parent's complaint and a
// colleague forwarding a notification arrive from the same address, on the same domain, looking
// identical. Parking the sender would hide the first to be rid of the second — and this evening
// was spent recovering a safeguarding message the app had hidden, so that is not a trade anyone
// should make twice.
//
// THE ASYMMETRY IS THE DESIGN. A false "no request" hides real work; a false "carries a request"
// costs somebody ten seconds of reading. So this ASSUMES A REQUEST and only says otherwise on
// positive evidence: it must find a forwarding/FYI marker AND find no request marker at all.
// Silence is not evidence — an empty message is treated as a request, not as nothing.
//
// PURE.

/**
 * NOTE ON THE DOUBLE BACKSLASH. These are built with `new RegExp` from a string, so a word
 * boundary must be written \\b. Written \b it is the BACKSPACE character (U+0008) and the
 * pattern silently matches nothing — which is exactly what happened on the first run here:
 * both alternations were dead, every message fell through to the default, and the tests
 * caught it only because they assert on real phrasing rather than on the regex.
 */
/**
 * Ways people ask for something. Deliberately broad: over-matching here is the SAFE direction,
 * because a match means "leave it in the queue".
 *
 * Note "do the needful" and "revert" — Indian English business idiom, both extremely common in
 * this corpus and both unambiguous requests. A detector written to British English alone would
 * miss them and park real work.
 */
const ASKS = new RegExp(
  '\\b(' +
  'please|kindly|request(ing|ed)?|require[ds]?|need(s|ed)?|want(s|ed)?|' +
  'can you|could you|would you|will you|may (i|we)|shall (i|we)|' +
  'let me know|let us know|inform me|update me|confirm|clarif(y|ication)|' +
  'arrange|provide|share|send|issue|allow|permit|approve|sanction|' +
  'do the needful|revert|follow ?up|action(ed)?|advise|assist|help' +
  ')\\b', 'i');

/** A question is a request, whatever words surround it. */
const QUESTION = /\?/;

/**
 * Phrases that explicitly DISCLAIM a request, checked ahead of ASKS.
 *
 * Needed because ASKS is deliberately broad and one of its words is `action` — which matches
 * "No action needed", the precise opposite of asking for something. An explicit disclaimer
 * outranks an incidental keyword. Written as a literal rather than assembled from a string, so
 * there is no backslash to get wrong.
 *
 * Still behind QUESTION: "No action needed, but can you confirm the date?" is a request.
 */
const NO_ASK = /\b(no action (needed|required)|nothing (needed|required) from you|no reply (needed|required)|for your (information|reference|records) only)\b/i;

/**
 * Markers that this is somebody passing something along rather than asking.
 *
 * "Fwd:"/"Fw:" is deliberately NOT here on its own. A forward is the commonest way a real
 * request reaches the desk — "Fwd: Protego card lost" was a genuine parent request in the live
 * corpus. A forward with nothing added is caught by the empty-remainder test instead.
 */
const FYI = new RegExp(
  '\\b(' +
  'f\.?y\.?i\.?|for your (information|reference|records)|just (so you know|informing)|' +
  'no action (needed|required)|nothing (needed|required) from you|' +
  'sharing (this|the)|passing (this )?on|to keep you in the loop|as discussed|' +
  'for your kind information|noted and forwarded|forwarding for information' +
  ')\\b', 'i');

export interface RequestSignal {
  /** True unless there is positive evidence the message asks for nothing. */
  carriesRequest: boolean;
  /** Always set, in plain language, because the desk is told why. */
  reason: string;
}

/**
 * Strip the quoted history off a forward, so the question a PARENT asked three replies down does
 * not read as a request the colleague is making now.
 *
 * Conservative: it cuts at the first attribution line, and if that leaves nothing it returns the
 * original rather than an empty string — an over-eager cut would manufacture a "no request".
 */
export function withoutQuotedHistory(body: string): string {
  const QUOTE_START = /\n\s*(-{2,}\s*Forwarded message|On .{0,80}wrote:|From:\s|-{3,}\s*Original Message)/i;
  const cut = (body ?? '').split(QUOTE_START)[0];
  return cut.trim().length > 0 ? cut : (body ?? '');
}

export function requestSignal(subject: string, body: string): RequestSignal {
  const own = withoutQuotedHistory(body ?? '');
  const hay = `${subject ?? ''}\n${own}`;

  if (QUESTION.test(hay)) {
    return { carriesRequest: true, reason: 'It asks a question.' };
  }
  if (NO_ASK.test(hay)) {
    return {
      carriesRequest: false,
      reason: 'It says in so many words that nothing is needed from the desk.',
    };
  }
  if (ASKS.test(hay)) {
    return { carriesRequest: true, reason: 'It asks for something in so many words.' };
  }

  // Nothing asked. Now: is there positive evidence it is a hand-off, or did the detector simply
  // fail to understand it? Only the first is safe to act on.
  if (FYI.test(hay)) {
    return {
      carriesRequest: false,
      reason: 'It reads as somebody passing information along — nothing is asked for.',
    };
  }

  // A forward with no words of its own is the case #5 actually names: "someone forwards to front
  // desk saying your query has come". If the colleague added nothing, they asked nothing.
  const addedWords = own.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
  if (addedWords <= 12 && /^\s*(fwd?|fw):/i.test(subject ?? '')) {
    return {
      carriesRequest: false,
      reason: 'A forward with nothing added — the sender asked for nothing themselves.',
    };
  }

  return {
    carriesRequest: true,
    reason: 'Nothing here says it can be set aside, so it stays in the queue.',
  };
}
