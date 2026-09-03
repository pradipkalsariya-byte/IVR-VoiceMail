// core/classify.ts — the classification seam.
//
// PURE and deterministic. Returns a suggestion plus a MANDATORY plain-language reason
// (AI-15: no black-box signal on a child; if it cannot explain itself it does not appear).
// The suggestion is advisory — a human confirms it (AI-13: the assistant never acts).
//
// This is the `rules` provider: no network, no data leaves the machine, so it is usable on
// real correspondence today. A model provider implements the same `Classifier` interface once
// the AI-20 DPDP gate is cleared (in-region or justified transfer + a DPDP-grade DPA + no
// training on school data). The screens never care which is behind the seam.

import { isSafeguardingCategory, type Urgency } from './taxonomy';
import type { SenderKind } from './senders';
import { machineFamily } from './machine-mail';
import { makeModelClassifier, modelConfigFromEnv } from './classify-model';

export interface ClassifyInput {
  subject: string;
  body: string;
  /** Who the sender wrote to. A vendor blast and a parent note look different here. */
  recipients?: string[];
  senderIsKnownFamily?: boolean;
  /** From core/senders.ts, when the caller knows it. An alumnus reads differently (QM-D40). */
  senderKind?: SenderKind;
}

export interface Suggestion {
  category: string;
  urgency: Urgency;
  /** Shown verbatim in the UI next to the suggestion. Never empty. */
  reason: string;
  isVendorNoise: boolean;
  isSafeguarding: boolean;
  /** Low confidence means "a human must read this" — the 14%-unroutable finding. */
  confidence: 'high' | 'low';
}

export interface Classifier {
  readonly name: string;
  classify(input: ClassifyInput): Suggestion;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Subjects that carry no routable signal at all — 14% of the real corpus. */
const UNROUTABLE = [
  '', '(no subject)', 'school', 'request', 'complaint', 'appointment', 'query', 'help',
  'urgent', 'important', 'hello', 'hi', 'question', 'concern', 'feedback',
];

// Safeguarding first, and it must WIN over transport: in the real corpus every single
// safety case was also a bus case, so a transport match must never shadow it. Named so the
// alumni hint below can defer to it — NOTHING may run ahead of this pattern.
//
// Deliberately broad. A false positive costs a human thirty seconds of reading; a false
// negative is a child. Note there is no trailing \b after stems like "harass" — the real
// corpus said "Harassment", which /\bharass\b/ silently missed.
//
// The second group — added 26-Aug-2026 — is how parents ACTUALLY describe a child being
// humiliated. Two live messages from one parent said "mocked", "reprimanded" and "traumatized"
// about a staff member's treatment of her daughter's hair, and matched not one word above.
// The pattern knew the safeguarding-policy vocabulary and not the parent's.
//
// Each stem is tightened against the school's own everyday language, which is the only reason
// they are not simple prefixes: "mock" alone would fire on every mock exam and mock test in the
// building, and "ridiculous" is what half of all complaints call the thing they are complaining
// about. So: the -ed/-ing forms only, which are what an allegation actually uses.
export const CHILD_SAFETY_RE =
  /\b(unattended|harass|abus(e|ed|ive)|molest|bully|safety failure|not safe|missing child|dropped at the wrong|left\s+(behind|alone|unattended|leaving|at\b|the\s+(child|student|kid))|(child|son|daughter|student|kid)\s+was\s+left|no ?one (was )?there to (receive|collect)|mock(ed|ing)|humiliat|traumati[sz]|taunt(ed|ing)|ridicul(e|ed|ing)|body.?sham|discriminat|singled out)/i;

/**
 * Drop the courtesy block that closes almost every email, before matching against the body.
 *
 * "Kindly do the needful!! Thank you. Regards, Tanisha Juneja" is not a message about
 * gratitude, but a keyword matcher reading the whole body cannot tell. On live data every
 * single praise suggestion — 20 of 20 — came from a sign-off exactly like that, and one of
 * them was a complaint titled "Disappointed with FWGS".
 *
 * Conservative on purpose: it cuts only from a sign-off word that has little after it (a
 * name, a number, a designation), so "thanks for looking into this, but the bus is still
 * late" keeps its substance and still classifies as transport.
 */
export function stripSignOff(body: string): string {
  const SIGNOFF = /\n\s*(thanks?( you)?|regards|warm regards|best regards|yours (sincerely|faithfully)|sincerely|cheers)\b[\s\S]{0,160}$/i;
  return (body || '').replace(SIGNOFF, '\n');
}

/**
 * Drop the list-server footer — text the SENDER did not write.
 *
 * The frontdesk@ addresses are Google Groups, so the list server appends "You received this
 * message because you are subscribed… To unsubscribe…" to essentially every message that
 * reaches the desk. That footer contains the word "unsubscribe", and VENDOR treats
 * "unsubscribe" as proof of marketing.
 *
 * Measured on live mail, 26-Aug-2026: that is how a parent's message alleging a staff member
 * had mocked her daughter (FD-0780, subject "URGENT: Immediate action required") came back
 * `not-a-request`, `urgency: low`, `confidence: high`. The classifier read the mailing list's
 * own boilerplate and concluded the parent was selling something.
 *
 * Applied to the vendor and job filters specifically, because those are the two that BURY a
 * message rather than merely mis-file it, and both do so at high confidence.
 */
export function stripListFooter(body: string): string {
  const FOOTER = /\n[^\n]*\b(you received this message because|to unsubscribe from this group|unsubscribe from this group and stop receiving|googlegroups\.com|confidentiality notice|this e-?mail (and any attachments )?(is|are) confidential)\b[\s\S]*$/i;
  return (body || '').replace(FOOTER, '\n');
}

const RULES: Array<{ cat: string; urgency: Urgency; why: string; re: RegExp; intent?: true }> = [
  { cat: 'child-safety', urgency: 'critical', why: 'mentions a child left, unattended, harassed or unsafe',
    re: CHILD_SAFETY_RE },
  // "pick up" and "drop off" are deliberately NOT here. That is how a parent describes
  // collecting their OWN child ("I will pick her up at 2pm") — a leave and attendance matter,
  // not a bus one — and including them put transport at 43% of all live mail. A pickup that
  // is genuinely about the bus says so: "pick-up point", "bus stop", "van".
  // Bare "transport" is NOT here either, and that one was worth measuring: it alone fired on
  // 109 of 303 live emails, always from the body, never the subject — it is a field label on
  // the school’s own form templates, not something a parent writes. One boilerplate word was
  // driving 36% of all classification. "driver" is in, after "Pls allow Viyu to come with
  // Subhash driver" landed in Systems.
  // Bare "route" went the same way on the next pass: 80 hits, every one from a "Transport
  // Route D-15 (…)" field on the parent-card form. "bus route" still matches, on "bus".
  { cat: 'transport',    urgency: 'high', why: 'is about a bus, stop or route',
    re: /\b(bus|bus.?stop|pick.?up point|pick.?up stop|van|shuttle|conductor|driver)\b/i },
  { cat: 'weather-closure', urgency: 'high', why: 'is about a closure, holiday or weather decision',
    re: /\b(red alert|heavy rain|rainfall|monsoon|weather|holiday declar|school closure|closure|timely decision|holiday decision)\b/i },
  // Certificates and records — a high-volume real stream. Must sit ABOVE the generic academic
  // and meetings rules, or "Request for bonafide certificate" falls through to a wrong bucket.
  { cat: 'certificates', urgency: 'normal', why: 'asks for a certificate, record or clearance',
    re: /\b(bonafide|bona fide|character certificate|leaving certificate|transfer certificate|\bTC\b|\bNOC\b|migration certificate|no.?dues|\bid card\b|duplicate receipt|transcript)\b/i },
  // Lost property BEFORE food: "two water bottles" was landing in Food & health on "water".
  { cat: 'lost-property', urgency: 'low', why: 'reports something lost or found',
    re: /\b(lost (and|&) found|lost .{0,20}(bag|bat|bottle|shoe|tiffin|jacket|watch)|missing (bag|bat|bottle|shoe|tiffin|jacket)|left behind at school)\b/i },
  { cat: 'fees', urgency: 'normal', why: 'is about fees, a refund or a payment',
    re: /\b(fee|fees|refund|instal?ment|payment|dues|invoice|receipt|imprest|hike)\b/i },
  { cat: 'selection', urgency: 'normal', why: 'disputes selection for a team, seat or activity',
    re: /\b(selection|selected|bias|trial|team announce|limited seats|not chosen|shortlist)\b/i },
  { cat: 'uniform', urgency: 'low', why: 'is about uniform, shoes or dress code',
    re: /\b(uniform|shoes|dress code|shorts|blazer)\b/i },
  { cat: 'leave-medical', urgency: 'normal', why: 'is about leave, illness or attendance',
    re: /\b(leave|medical|sick|illness|absent|attendance|fever|surgery|recover)\b/i },
  // Bare "grade" and "marks" are gone: every "Student Exit Pass — New Form filled for X
  // (Grade 10 …)" subject carries the word, and including it pushed academic from 4 to 86 of
  // 303 live emails in a single change. Grade is a NOUN of address here, not a subject-matter.
  { cat: 'academic', urgency: 'normal', why: 'is about assessment, grades or curriculum',
    re: /\b(exam|examination|report card|assessment|curriculum|homework|personal project|moderation|grade ?(book|sheet)|marks? (sheet|statement|obtained)|re.?evaluation)\b/i },
  { cat: 'food-health', urgency: 'normal', why: 'is about food, the menu or hygiene',
    re: /\b(food|menu|lunch|snack|canteen|hygiene|virus|drinking water|water quality)\b/i },
  { cat: 'systems', urgency: 'low', why: 'is about a login, upload or app problem',
    re: /\b(login|log ?in|password|portal|upload|app|photo|nucleus|otp|not working|error)\b/i },
  { cat: 'meetings', urgency: 'low', why: 'asks for a meeting or appointment',
    re: /\b(meeting|appointment|schedule a call|come and meet|discuss in person)\b/i },
  { cat: 'school-direction', urgency: 'normal', why: 'questions a school-level policy or change',
    re: /\b(class size|students in a class|change management|policy of|moving away from|direction of the school)\b/i },
  { cat: 'camps-services', urgency: 'low', why: 'is about a camp, club or optional service',
    re: /\b(camp|club|optional service|after.?school|workshop|excursion|field trip)\b/i },
  { cat: 'about-other-parent', urgency: 'normal', why: 'concerns another family, not the sender’s own child',
    re: /\b(parent of grade|another parent|other child’s parent|complain about parent)\b/i },
  // Praise is a RESIDUAL, so it sits far down this list — see below. Bare "thank you" and
  // "thanks" are gone from it entirely: they are how Indian parents close almost every email,
  // including complaints, and stripSignOff cannot catch a mid-body courtesy. What is left are
  // words that only appear when someone is actually pleased.
  { cat: 'praise', urgency: 'low', why: 'reads as thanks or a child’s achievement', intent: true,
    re: /\b(grateful|gratitude|shout ?out|appreciat(e|ed|ion)|kudos|best school|well done|selected for|achievement|won the|proud of)\b/i },
];

/** ~50% of the real public-address traffic. Filtering this is the assistant's biggest win. */
const VENDOR = /\b(proposal|invitation to speak|ranking|rankings|award|webinar|summit|demo|partnership|introducing|connecting with|exclusive feature|unsubscribe|pricing|our platform|trial account|brochure|empanel)\b/i;
const JOB = /\b(application for the post|resume|curriculum vitae|\bcv\b|job opportunit|vacancy|apply for the position)\b/i;

/**
 * The alumni lean. Broader than the certificates rule on purpose: "marks verification" or a bare
 * "certificate" from a parent could be about anything, but from an a<year>. account it is almost
 * always a records request — the 2026 corpus's a2026. sender was exactly this (QM-D40 confirmed
 * the prefix reading, and it corroborated EXC-5's alumni certificate-request path as evidenced,
 * not hypothetical).
 */
const ALUMNI_CERT_RE = /\b(certificat|transcript|verif(y|ied|ication)|attestation|bonafide|bona fide|migration|no.?dues|marksheet|mark sheet|degree|convocation)/i;

export const rulesClassifier: Classifier = {
  name: 'rules',
  classify({ subject, body, senderIsKnownFamily, senderKind }): Suggestion {
    const subj = norm(subject);
    const hay = `${subject} ${body}`;

    // Child safety is an ABSOLUTE override, and it runs FIRST — ahead of the vendor and job
    // filters, not behind them.
    //
    // It used to sit third, and that was a real safeguarding miss, found on 26-Aug-2026 by
    // running rules and the model across the same live mail and reading every disagreement. Two
    // messages from one parent — "URGENT: Immediate action required" and "Disappointed with
    // FWGS", alleging a staff member had mocked her daughter over her hair — matched VENDOR and
    // came back `not-a-request`, `urgency: low`, `confidence: high`. Filed as marketing noise,
    // at the bottom of the queue, with the classifier sure of itself.
    //
    // CHILD_SAFETY_RE's own comment already said "NOTHING may run ahead of this pattern". Two
    // branches did. Ordering is the only thing that makes an override absolute, so it is now
    // first in the function and there is nothing left above it to shadow it.
    if (CHILD_SAFETY_RE.test(hay)) {
      const inSubject = CHILD_SAFETY_RE.test(subject);
      return {
        category: 'child-safety', urgency: 'critical', isVendorNoise: false,
        isSafeguarding: true,
        confidence: inSubject ? 'high' : 'low',
        reason: inSubject
          ? 'Subject mentions a child left, unattended, harassed or unsafe.'
          : 'Subject gave no clue; the body mentions a child left, unattended, harassed or unsafe.',
      };
    }

    // Template mail, identified by its subject shape. Second only to safeguarding, because a
    // template has one right answer and nothing below this line should be guessing at it —
    // 144 of the 280 live emails since 01-Aug are one of these families.
    //
    // `confidence: 'high'` is meant literally here in a way it is not elsewhere: this is not a
    // keyword leaning one way, it is a subject line assembled by a form. See core/machine-mail.ts
    // for what each family is and why it lands where it does.
    const machine = machineFamily(subject);
    if (machine) {
      return {
        category: machine.category, urgency: machine.urgency,
        isVendorNoise: machine.category === 'not-a-request',
        isSafeguarding: false, confidence: 'high', reason: machine.reason,
      };
    }

    // Ahead of the vendor/job filters, deliberately: an alumnus is an authenticated
    // school-domain account (QM-D40 — the s. account RENAMED at graduation, EGS-15's "the
    // account lives on"), so the noise heuristics built for unknown external senders must
    // never park their request. It no longer re-tests CHILD_SAFETY_RE: safeguarding has already
    // returned above, so nothing reaching this line is a safeguarding message.
    if (senderKind === 'alumnus' && ALUMNI_CERT_RE.test(hay)) {
      return {
        category: 'certificates', urgency: 'normal', isVendorNoise: false, isSafeguarding: false,
        confidence: ALUMNI_CERT_RE.test(subject) ? 'high' : 'low',
        reason: 'From an alumni account, mentioning a record or verification — '
          + 'alumni traffic is disproportionately certificate requests (EXC-5 path).',
      };
    }

    // These two read a FOOTER-STRIPPED body, not `hay`. Both bury a message at high confidence,
    // so neither may fire on text the list server appended rather than the sender wrote.
    const written = `${subject} ${stripListFooter(body ?? '')}`;

    if (!senderIsKnownFamily && VENDOR.test(written)) {
      return {
        category: 'not-a-request', urgency: 'low', isVendorNoise: true, isSafeguarding: false,
        confidence: 'high',
        reason: 'Reads as vendor or marketing outreach, and the sender is not a known family.',
      };
    }
    if (!senderIsKnownFamily && JOB.test(written)) {
      return {
        category: 'not-a-request', urgency: 'low', isVendorNoise: true, isSafeguarding: false,
        confidence: 'high',
        reason: 'Reads as a job application — belongs with recruitment, not the desk.',
      };
    }

    // SCORE every rule rather than returning the first that matches anywhere.
    //
    // First-match-in-list-order was the bug behind the loudest complaint of the 26-Aug review
    // ("everything seems to be praise and achievement"). `praise` sat fourth and matched a bare
    // "thanks" anywhere in the body, so every polite email the three rules above it missed
    // became praise: 20 of 20 live suggestions were wrong, including "Requesting for sick
    // leave" and "Re: Disappointed with FWGS" — a complaint filed as praise. The same ordering
    // put `transport` at 43% of all mail, because "pick up" appears in most early-leave notes.
    //
    // What the SUBJECT says outranks what the body says, always: a subject is what the sender
    // chose to call the thing, a body is full of incidental words. List order survives only as
    // a tie-break between rules with equal evidence.
    // An "intent" rule is one whose words state what the sender WANTS rather than what the
    // message is about. "Gratitude for selection to the Pickleball World Cup" matches both
    // praise and selection in its subject; praise is right, because the selection rule exists
    // for DISPUTES about selection, and "selection" here is merely the topic. Topic words
    // co-occur constantly; someone putting gratitude in a subject line means it.
    const bodyForScoring = stripSignOff(body);
    type Scored = { r: (typeof RULES)[number]; inSubject: boolean; score: number };
    const scored: Scored[] = [];
    RULES.forEach((r, i) => {
      const inSubject = r.re.test(subject);
      const inBody = r.re.test(bodyForScoring);
      if (!inSubject && !inBody) return;
      const intentBonus = r.intent && inSubject ? 50 : 0;
      scored.push({ r, inSubject, score: (inSubject ? 100 : 0) + (inBody ? 10 : 0) + intentBonus - i });
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best) {
      // A body-only match is weak evidence. It still suggests — the desk would rather see a
      // guess with its reasoning than a blank — but it must not claim confidence it lacks.
      return {
        category: best.r.cat,
        urgency: best.r.urgency,
        isVendorNoise: false,
        isSafeguarding: isSafeguardingCategory(best.r.cat),
        confidence: best.inSubject ? 'high' : 'low',
        reason: best.inSubject
          ? `Subject ${best.r.why}.`
          : `Subject gave no clue; the body ${best.r.why}.`,
      };
    }

    const unroutable = UNROUTABLE.includes(subj.replace(/^(re|fwd):\s*/i, '').trim());
    return {
      // Never guess a plausible category. An unmatched item must LOOK untriaged so a person
      // picks it up — hiding it in "Meetings" made the classifier confidently wrong.
      category: 'unclassified',
      urgency: 'normal',
      isVendorNoise: false,
      isSafeguarding: false,
      confidence: 'low',
      reason: unroutable
        ? `The subject ("${subject || 'no subject'}") carries no routable signal, and nothing in the body matched a known category. Needs a person to read it.`
        : 'Nothing matched a known category with confidence. Needs a person to read it.',
    };
  },
};

/**
 * Switchboard traffic: "connect me to Ms X", "ask her to call me back", "pass this on".
 *
 * 304 of 636 real logged calls (48%) read like this, and 53% were marked "passed to Self".
 * These are callback slips, not requests with substance. They ride the same record and the
 * same lifecycle — but flagged, so the working queue can be viewed without them.
 */
/** Unambiguous "this is for someone else" phrasings. */
const SWITCHBOARD = /\b(wants? to (speak|talk)|speak (to|with)|talk (to|with)|connect (me|to|with|her|him)|transfer(red)? (the )?call|put (me|her|him) through|pass (this |it |the message )?on|message for|is .{0,20}available|wanted to reach)\b/i;

/** "Call back" only counts when the CALLER is asking for one. */
const CALLBACK_REQUESTED = /\b(ask(ed)? .{0,24}to call ?back|please call ?back|wants? a call ?back|request(ed|ing)? a call ?back|call ?back requested)\b/i;

/**
 * "…and we promised to call back" is a commitment WE made while handling a real request — not
 * a message to pass on. Treating it as switchboard mis-filed a genuine late-bus complaint in
 * testing, which is exactly the kind of item that must stay visible in the working queue.
 */
const CALLBACK_PROMISED = /\b(promised|assured|told .{0,20}(we|I) would|will|would|going to|shall)\b.{0,30}\bcall ?back\b/i;

export function looksLikeSwitchboard(text: string): { yes: boolean; reason: string } {
  const s = text ?? '';
  const m = SWITCHBOARD.exec(s);
  if (m) {
    return { yes: true, reason: `Reads as a message for someone else ("${m[0]}") rather than a request to act on.` };
  }
  const cb = CALLBACK_REQUESTED.exec(s);
  if (cb && !CALLBACK_PROMISED.test(s)) {
    return { yes: true, reason: `The caller asked for a call back ("${cb[0]}") — a message to pass on.` };
  }
  return { yes: false, reason: 'Reads as a request with substance, not a message to pass on.' };
}

export function getClassifier(name = 'rules'): Classifier {
  if (name === 'rules') return rulesClassifier;
  // The model provider, registered after VK cleared the AI-20 DPDP gate on 2026-08-26. It is
  // resolved lazily to keep this module free of its imports, and it answers SYNCHRONOUSLY from
  // rules — only callers that can await classifyAsync get the model. See core/classify-model.ts
  // for what is redacted before anything leaves the machine.
  if (name === 'model') return makeModelClassifier(modelConfigFromEnv(rulesClassifier));
  // A model-backed provider registers here once the AI-20 DPDP gate is cleared. Failing
  // closed is deliberate: an unknown provider must never silently fall back to sending
  // real correspondence somewhere unapproved.
  throw new Error(
    `Unknown classifier "${name}". Available: "rules", "model".`,
  );
}
