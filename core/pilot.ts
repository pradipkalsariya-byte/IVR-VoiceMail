// core/pilot.ts — where a real email reply actually goes during the pilot. PURE.
//
// The record page has always told staff a reply "reaches the family... from the school's
// address" — a promise the Team Deck made too ("nothing changes — the reply still comes from
// the address they already know"). Wiring real sending for the first time (2026-08-12) makes
// that promise suddenly capable of being TRUE, which means it can also suddenly be WRONG in a
// way that reaches a real person: a half-tested reply pipeline sending to a real parent during
// the pilot is not a bug to fix later, it is the thing this module exists to prevent.
//
// VK, 2026-08-12: during the pilot, an email reply goes to the team lead reviewing pilot
// output, cc'd to whoever needs to see it — never to the real family. The in-app rail is
// DELIBERATELY untouched: it never leaves this system either way (the family reads it by
// signing in, the same as staff writing it), so there is nothing for pilot mode to intercept.

export interface PilotConfig {
  enabled: boolean;
  reviewerEmail: string | null;
  ccEmails: string[];
}

export function pilotConfigFromEnv(env: Record<string, string | undefined> = process.env): PilotConfig {
  return {
    enabled: env.PILOT_MODE === 'true',
    reviewerEmail: env.PILOT_REVIEWER_EMAIL?.trim() || null,
    ccEmails: (env.PILOT_CC_EMAILS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  };
}

export interface EmailEnvelope {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** True when this envelope is a pilot redirect — never the real family. */
  redirected: boolean;
}

/**
 * Where an email reply actually goes. The real family address goes IN; a pilot-aware envelope
 * comes OUT. During pilot the real address never appears in To or Cc — only named inside the
 * body text — so a reviewer sees exactly who this would have reached without the risk of an
 * accidental reply-all reaching a real inbox. Off (or misconfigured — no reviewer address set),
 * this is a pure passthrough: the real family, unprefixed, unmodified.
 */
export function emailEnvelope(
  realFamilyEmail: string,
  subject: string,
  body: string,
  pilot: PilotConfig,
): EmailEnvelope {
  if (!pilot.enabled || !pilot.reviewerEmail) {
    return { to: [realFamilyEmail], cc: [], subject, body, redirected: false };
  }
  return {
    to: [pilot.reviewerEmail],
    cc: pilot.ccEmails,
    subject: `[PILOT] ${subject}`,
    body:
      `— PILOT MODE — this reply was written for ${realFamilyEmail} and is being routed to you ` +
      `for review. The family has NOT received it. —\n\n${body}`,
    redirected: true,
  };
}
