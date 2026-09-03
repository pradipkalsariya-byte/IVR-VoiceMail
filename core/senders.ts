// core/senders.ts — who sent this, really?
//
// In core/ rather than tools/ because live ingestion needs it as much as offline analysis:
// the same 57%-machine finding decides what reaches the working queue.
//
// PURE. Every pattern below was observed in the live FSK/FWGS front-desk archives on
// 2026-08-05. The machine list is the important one: a 30-conversation census showed 57% of
// the FSK desk's traffic is the school's own systems emailing humans. Those are EVENTS, not
// requests, and separating them is the single biggest reduction available.

export type SenderKind = 'machine' | 'parent' | 'student' | 'alumnus' | 'staff' | 'external';

export const SCHOOL_DOMAINS = [
  'fountainheadschools.org', 'fsksurat.in', 'fsmsurat.in', 'fwgs.in', 'falh.in',
  'fasv.in', 'fpvesu.in', 'fpadajan.in', 'fountainheadpreschools.org',
  // The outsourced operator is not the school, but its staff act as owners (R3-23).
  'protego.services',
];

/** Display names and addresses that are unambiguously automated. */
const MACHINE_NAME = [
  /^Student Exit Pass$/i,
  /^Student\s*:\s*Bonafide Certificate$/i,
  /^Nucleus-/i,                       // Nucleus-ICard, Nucleus-Sickbay visit, Nucleus-Personal Details
  /^Enjay Synapse$/i,                 // telephony: missed-call reports
  /\(via Google Sheets\)$/i,
  /^Google Forms?$/i,
  /^Frontdesk Support$/i,
];

const MACHINE_LOCALPART = [
  /^donotreply$/i, /^no-?reply$/i, /^mailer-daemon$/i, /^admindocs$/i,
  /^transport\.support$/i, /^forms?-receipts?$/i,
];

/** Subjects that mark a message as a system notification even from a human account. */
const MACHINE_SUBJECT = [
  /New Form filled for/i,
  /^.*filled by\s*-/i,
  /Spreadsheet shared with you/i,
  /has visited sickbay/i,
  /^EarlyIn (Reject Form|Student Stayback List)/i,
  /Form submitted$/i,
  /assigned you an action item/i,
];

const MACHINE_BODY = [
  /THIS EMAIL IS GENERATED/i,
  /do not reply to this (e-?mail|message)/i,
  /this is an automated (message|notification)/i,
];

export const isSchoolDomain = (email: string) => {
  const d = (email.split('@')[1] ?? '').toLowerCase();
  return SCHOOL_DOMAINS.includes(d);
};

// The account conventions, ratified as QM-D40 (2026-08-07). Two earlier readings of these were
// WRONG and are recorded so they are not reintroduced:
//   - `s.` was called "legacy". It is the CURRENT student convention. It appears in the legacy
//     analysis docs, but appearing there is not evidence of retirement.
//   - `a<year>.` was read as a student joining-year prefix. It is the ALUMNI prefix and the digits
//     are the GRADUATION year — which is exactly what EGS-15 keys cohorts on ("Alumni 2026").
// On graduation the `s.` account is RENAMED to `a<graduation-year>.`; per EGS-15 the account itself
// lives on, which is why an alumnus can still write in (and does — EXC-5's alumni request path).
//
// Every prefix test is gated on the school domain by isFrom(). Ungated, `p.mehta@somesupplier.test`
// classified as a family, which set senderIsKnownFamily, disabled the vendor-noise filter and
// started a response clock — on an archive where ~50% of public-address inbound is solicitation.
const isFrom = (email: string, prefix: RegExp) =>
  isSchoolDomain(email) && prefix.test(email.split('@')[0] ?? '');

/** Parents hold accounts like p.<child-first>.<child-last>@<domain>, display "Parents of <child>". */
export const isParentAddress = (email: string) => isFrom(email, /^p\./i);
export const isParentName = (name: string) => /^parents?\s+of\s+/i.test(name.trim());

/** Enrolled students hold accounts like s.<first>.<last>@<domain>. */
export const isStudentAddress = (email: string) => isFrom(email, /^s\./i);

/** Alumni hold accounts like a<graduation-year>.<first>.<last>@<domain>. */
export const isAlumnusAddress = (email: string) => isFrom(email, /^a\d{4}\./i);

/** The graduation year off an alumnus address, or null. Never inferred from anything else. */
export const alumnusGraduationYear = (email: string): number | null => {
  if (!isAlumnusAddress(email)) return null;
  const m = /^a(\d{4})\./i.exec(email.split('@')[0] ?? '');
  return m ? Number(m[1]) : null;
};

/**
 * The child's name straight out of a p./s./a<year>. address — "Aarav Shah" from
 * p.aarav.shah@fsksurat.in — with zero roster lookup. Added 2026-08-12: most real front-desk
 * mail already carries this in the address itself, so a family with no roster/Family match yet
 * still gets addressed by name instead of "Sender not identified". A GUESS, not a verified
 * identity — never conflate this with a linked Family (that governs the reply rail; this only
 * governs a display label).
 */
export function guessNameFromAddress(email: string): string | null {
  if (!isSchoolDomain(email)) return null;
  const local = (email.split('@')[0] ?? '');
  const m = /^(?:p|s|a\d{4})\.(.+)$/i.exec(local);
  if (!m) return null;
  const parts = m[1].split('.').filter(Boolean);
  if (parts.length === 0) return null;
  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

/**
 * FSK student/parent addresses exist on TWO domains that alias ONE Google account (mirrors
 * career-counselling's engine/roster.ts:emailVariants, which solved this first — same narrow
 * scope, kept in step deliberately): s.first.last@fsksurat.in ⟷ s.first.last@fountainheadschools.org,
 * p.* likewise. A family may sign in — or mail in — from either. Returns every address the same
 * mailbox answers to, the given one first. Deliberately NARROW: only the s./p. prefix pattern on
 * exactly this domain pair — no evidence any other domain in SCHOOL_DOMAINS aliases this way.
 */
export function emailVariants(email: string): string[] {
  const m = /^([sp]\.[^@\s]+)@(fsksurat\.in|fountainheadschools\.org)$/i.exec(email.trim().toLowerCase());
  if (!m) return [email.trim().toLowerCase()];
  const other = m[2].toLowerCase() === 'fsksurat.in' ? 'fountainheadschools.org' : 'fsksurat.in';
  return [`${m[1]}@${m[2].toLowerCase()}`, `${m[1]}@${other}`];
}

export interface SenderInput {
  name: string;
  email: string;
  subject?: string;
  body?: string;
}

export interface SenderVerdict {
  kind: SenderKind;
  /** Why — kept so a surprising classification can be argued with rather than trusted. */
  reason: string;
  /** A stable, non-identifying key for counting distinct senders. */
  key: string;
}

export function classifySender({ name, email, subject = '', body = '' }: SenderInput): SenderVerdict {
  const local = (email.split('@')[0] ?? '').toLowerCase();
  const domain = (email.split('@')[1] ?? '').toLowerCase();

  for (const re of MACHINE_NAME) {
    if (re.test(name)) return { kind: 'machine', reason: `sender name matches ${re}`, key: `machine:${name.toLowerCase()}` };
  }
  for (const re of MACHINE_LOCALPART) {
    if (re.test(local)) return { kind: 'machine', reason: `address local-part matches ${re}`, key: `machine:${local}` };
  }
  for (const re of MACHINE_SUBJECT) {
    if (re.test(subject)) return { kind: 'machine', reason: `subject is a system notification (${re})`, key: `machine:subject` };
  }
  for (const re of MACHINE_BODY) {
    if (re.test(body.slice(0, 2000))) return { kind: 'machine', reason: 'body declares itself auto-generated', key: 'machine:body' };
  }

  if (isParentAddress(email) || isParentName(name)) {
    return { kind: 'parent', reason: 'parent account or "Parents of" display name', key: `parent:${local || name.toLowerCase()}` };
  }
  if (isStudentAddress(email)) {
    return { kind: 'student', reason: 'enrolled-student account (s. prefix)', key: `student:${local}` };
  }
  // Before alumni existed as a kind, an a<year>. sender was filed as a current student. It matters:
  // an alumnus has no enrolment, no guardian to notify and no campus by posting, so anything keyed
  // on those is wrong for them — and their traffic is disproportionately certificate requests.
  if (isAlumnusAddress(email)) {
    const year = alumnusGraduationYear(email);
    return { kind: 'alumnus', reason: `alumni account (graduated ${year})`, key: `alumnus:${local}` };
  }
  if (isSchoolDomain(email)) {
    return { kind: 'staff', reason: `school/operator domain (${domain})`, key: `staff:${local}@${domain}` };
  }
  return { kind: 'external', reason: domain ? `outside domain (${domain})` : 'no parsable address', key: `external:${domain || 'unknown'}` };
}

/**
 * Which campus a student/parent email's domain belongs to — the same narrow alias pair
 * emailVariants knows: fsksurat.in and fountainheadschools.org are the same mailbox, both FSK.
 * fwgs.in is FWGS's own. Refuses (null) rather than guesses for any other domain — used by the
 * roster/phone importers to reject a row rather than mis-file it onto a campus with no evidence.
 */
const DOMAIN_CAMPUS: Record<string, string> = {
  'fwgs.in': 'fwgs',
  'fsksurat.in': 'fsk',
  'fountainheadschools.org': 'fsk',
};

export function campusForAddress(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? DOMAIN_CAMPUS[domain] ?? null : null;
}

/** Rolling notification threads: a machine sender replying into one thread for months. */
export function isRollingThread(args: {
  senderKinds: SenderKind[];
  messageCount: number;
  spanDays: number;
}): boolean {
  const machineShare = args.senderKinds.filter(k => k === 'machine').length / Math.max(1, args.senderKinds.length);
  // The live example: "frontdesk missed call report" — 775 messages, one thread, years.
  return args.messageCount >= 20 && args.spanDays >= 14 && machineShare >= 0.5;
}
