// tools/mbox/redact.ts — redaction, applied before anything is written to a report.
//
// PURE. This archive is children's data. The analysis output must be safe to paste into a
// document and share, which means it can carry counts, distributions and shapes — never
// names, addresses, phone numbers or student IDs.
//
// Redaction is imperfect on free text by nature, which is exactly why the analyser only ever
// emits redacted SUBJECTS and aggregates, and never message bodies.

export interface RedactOptions {
  /** Extra literal names to mask, e.g. staff names pulled from the group's member list. */
  extraNames?: string[];
}

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
// Indian mobile numbers, with or without +91 / leading 0, and 6-8 digit landlines.
const PHONE = /(\+?91[\s-]?)?\b0?[6-9]\d{9}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/g;
// Student IDs seen in the live archive: FSK2099001, FSK2099002.
const STUDENT_ID = /\b(FSK|FWGS|FSM|FALH|FPV|FPA|FSNC)\d{4,8}\b/gi;
// URL_RE, not URL: a top-level `const URL` shadows the global URL CONSTRUCTOR for this whole
// module — and for every module a bundler flattens into one scope. It cost an hour on
// 26-Aug-2026, when `new URL(...)` inside a bundled diagnostic threw "URL is not a constructor"
// and looked exactly like a network fault.
const URL_RE = /\bhttps?:\/\/\S+/g;
// Aadhaar: four-four-four, with the separators people actually type. The earlier pattern
// allowed a space only, so "2222-2222-2222" passed redaction untouched — and residualPii()
// did not look for Aadhaar at all, so the backstop could not catch what redaction missed.
//
// This stopped being hypothetical on 2026-08-08: the archive's LARGEST mail family (10,660
// ID-card verification notifications) carries a `Student Aadhaar Card No.` field on 5,264 of
// them, plus Aadhaar photographs, caste, religion and date of birth. Aadhaar is squarely a
// DPDP identifier and the one number in this corpus you can least afford to leak.
//
// Separators are independent rather than back-referenced on purpose: "2222 2222-2222" is a
// real thing people type, and for a gate whose failure mode is "abort the run", matching too
// much costs a re-run while matching too little costs a leak.
const AADHAAR = /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g;

/**
 * "Parents of Alpha Sample" → "Parents of «child»".
 * Deliberately NOT case-insensitive: with /i the [A-Z] classes also match lower case, so the
 * pattern greedily swallowed the following prose ("… wrote in") instead of just the name.
 */
const PARENTS_OF = /\b([Pp]arents?\s+[Oo]f)\s+[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3}/g;

/** Grade/section tails that combine with a name to identify: "(Grade 8 - Zeta)". */
const GRADE_SECTION = /\((Grade|Junior KG|Senior KG|Nursery|PYP|MYP|DP)[^)]{0,30}\)/gi;

export function redact(text: string, opts: RedactOptions = {}): string {
  let s = text ?? '';

  s = s.replace(PARENTS_OF, (_m, p) => `${p} «child»`);
  s = s.replace(EMAIL, '«email»');
  s = s.replace(AADHAAR, '«id»');
  s = s.replace(PHONE, '«phone»');
  s = s.replace(STUDENT_ID, '«student-id»');
  s = s.replace(URL_RE, '«url»');
  s = s.replace(GRADE_SECTION, '(«grade»)');

  for (const n of opts.extraNames ?? []) {
    if (n.trim().length < 3) continue;
    s = s.replace(new RegExp(`\\b${n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '«name»');
  }

  return s;
}

/**
 * A subject safe to quote in a report: redacted, trimmed, and with any trailing
 * "for <Name> (...)" construction collapsed. Auto-notification subjects carry a child's
 * name and ID by design, so this matters most for them.
 */
export function redactSubject(subject: string, opts: RedactOptions = {}): string {
  let s = redact(subject, opts);
  // Mask "for <Person Name>", but ONLY in subjects that are clearly system notifications.
  //
  // That is where the risk actually lives: automated subjects embed a child's name by design
  // ("New Form filled for <name> (Grade 8) (FSK…)"). Human-written subjects are title-cased
  // prose, and applying the rule to them mangled real content — "Correction Request for
  // Attendance" and "Request for Timely Decision-Making…" both became "for «child»". Gating on
  // an already-masked id/grade or explicit notification wording keeps it precise.
  const isNotification = /«student-id»|«grade»|\b(form filled|notification|has visited|auto-generated|update request)\b/i.test(s);
  if (isNotification) {
    const NAME = "[A-Z][a-z][\\w'’-]*";
    s = s.replace(new RegExp(`\\bfor\\s+${NAME}(?:\\s+${NAME})*(?=\\s*[(«]|$)`, 'g'), 'for «child»');
    // Notification subjects also carry the name in other positions — leading ("Delta Sample
    // has visited sickbay"), or after a dash. Inside a machine subject, a run of two or more
    // Capitalised-lowercase words is almost always a name; the exceptions are the form's own
    // boilerplate, so those words are excluded rather than the rule being abandoned.
    const BOILER = new Set(['student','exit','pass','form','new','card','update','request',
      'personal','details','bonafide','certificate','local','field','trip','daily','report',
      'early','stayback','list','approved','rejected','students','attendance','concern',
      'schedule','feedback','notification','sickbay','visit','dear','front','desk','id','odas']);
    s = s.replace(new RegExp(`${NAME}(?:\\s+${NAME})+`, 'g'), (run) => {
      const words = run.split(/\s+/);
      const allBoiler = words.every(w => BOILER.has(w.toLowerCase()));
      return allBoiler ? run : '«child»';
    });
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Assert nothing obviously identifying survived. Used by the analyser before it writes.
 *
 * The gate exists to catch what redaction MISSED, so every identifier class redact() masks
 * must appear here too. Aadhaar did not, until 2026-08-08 — redact() masked it while the
 * backstop was blind to it in every format, which is the one asymmetry a backstop cannot
 * have. Verified against the generated report before shipping: no false abort.
 */
export function residualPii(text: string): string[] {
  const hits: string[] = [];
  if (EMAIL.test(text)) hits.push('email');
  if (STUDENT_ID.test(text)) hits.push('student-id');
  if (PHONE.test(text)) hits.push('phone');
  if (AADHAAR.test(text)) hits.push('aadhaar');
  // Reset lastIndex on the shared global regexes.
  EMAIL.lastIndex = STUDENT_ID.lastIndex = PHONE.lastIndex = AADHAAR.lastIndex = 0;
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Body redaction — added 2026-08-26 for the model classifier.
//
// Everything above was built for ARCHIVE REPORTS, and this file's own header says why that was
// safe: "the analyser only ever emits redacted SUBJECTS and aggregates, and never message
// bodies". Sending bodies to a model is a different job, and the first check against real mail
// proved the difference — redact() passed "my daughter Dhyaana's Morker drop" and "my daughter
// Aahira Bhatia grade 1" untouched, while residualPii() reported nothing wrong, because it
// never looked for names at all.
//
// So: a stricter pass for bodies, and a name detector that makes the refusal real. Neither
// changes redact() or residualPii(), so the archive tooling behaves exactly as before.

/** Words that almost always precede a child's name in a parent's message. */
const RELATION = '(?:daughter|son|child|ward|kid|grand[- ]?(?:son|daughter))';

/** A capitalised run of one to three words — a person's name, as written. */
const NAME_RUN = "[A-Z][\\w'’-]+(?:\\s+[A-Z][\\w'’-]+){0,2}";

/** "my daughter Aahira Bhatia", "our son Vivaan" — the commonest way a name appears. */
const RELATION_NAME = new RegExp(
  `\\b(?:my|our|the)?\\s*${RELATION}\\s+(${NAME_RUN})`, 'gi',
);

/** "for Reyansh", "of Simran Adnani", "Notification - Jetr Bhatia" — weaker but reliable. */
const ANCHORED_NAME = new RegExp(
  `\\b(?:for|of|named|name\\s+is|regarding)\\s+(${NAME_RUN})`, 'g',
);

/** A name after a dash in a machine subject line: "Exit Pass Notification - Jetr Bhatia". */
const DASHED_NAME = new RegExp(`[-–—]\\s+(${NAME_RUN})(?=\\s*[(«]|\\s*$)`, 'gm');

/** An email sign-off: "Kind regards, Aman Kuba" / "Thanks,\nPriya Shah". */
const SIGNOFF_NAME = new RegExp(
  `\\b(?:regards|thanks|thank\\s+you|sincerely|cheers)\\s*,?\\s*(${NAME_RUN})`, 'gi',
);

/** Spaced or grouped phone numbers the compact pattern misses: "8000 130 031". */
const SPACED_PHONE = /\b\d{3,5}[\s-]\d{3}[\s-]\d{3,4}\b/g;

/** Card tails: "card ending with 9654", "ending 4321". Not caught by the phone pattern. */
const CARD_TAIL = /\b(card\s+)?ending\s+(with\s+)?\d{4}\b/gi;

/** A possessive immediately after a mask we just applied: "«child»’s bus stop". */
const MASK_POSSESSIVE = /«child»['’]s/g;

/**
 * Redact a message BODY hard enough to send somewhere else.
 *
 * `knownNames` should carry every name the database already holds for this request — the family
 * label, the child, the sender. Those are exact and therefore the most reliable masking
 * available; the patterns below only exist for the cases where we hold nothing.
 */
export function redactBody(text: string, knownNames: readonly string[] = []): string {
  let s = redact(text ?? '', { extraNames: [...knownNames] });

  // Each pattern keeps its anchor and replaces only the captured NAME, so the sentence still
  // reads ("my daughter «child» is unwell") and the model keeps the meaning it needs.
  const maskCapture = (re: RegExp, mask: string) => {
    s = s.replace(re, (m, name: string) => m.replace(name, mask));
  };
  maskCapture(RELATION_NAME, '«child»');
  maskCapture(ANCHORED_NAME, '«name»');
  maskCapture(DASHED_NAME, '«name»');
  maskCapture(SIGNOFF_NAME, '«name»');

  s = s.replace(SPACED_PHONE, '«phone»');
  s = s.replace(CARD_TAIL, 'card ending «digits»');
  s = s.replace(MASK_POSSESSIVE, '«child»');
  return s;
}

/**
 * Names that survived redaction, so a caller can REFUSE rather than send.
 *
 * Deliberately anchored rather than "any capitalised word": English prose capitalises sentence
 * starts, place names, months and school jargon, and flagging those would refuse nearly every
 * message — a guard that always fires teaches people to switch it off. This catches what the
 * patterns above are supposed to have masked, so it is really a check that they WORKED.
 */
export function residualNames(text: string): string[] {
  const hits: string[] = [];
  const check = (re: RegExp, label: string) => { if (re.test(text)) hits.push(label); };

  check(new RegExp(`\\b${RELATION}\\s+[A-Z]`), 'name-after-relation');
  check(new RegExp(`\\b(?:for|of|named|regarding)\\s+${NAME_RUN}\\b`), 'name-after-anchor');
  check(new RegExp(`\\b(?:regards|thanks|sincerely)\\s*,?\\s+[A-Z][\\w'’-]{2,}`, 'i'), 'name-in-signoff');
  // Anchored the SAME way DASHED_NAME is, and the anchor is the whole point. Unanchored, this
  // fired on any two capitalised words after any dash — which in school mail means subject
  // boilerplate. Measured against real traffic on 26-Aug-2026 it refused 27 of 60 emails, on
  // matches like "- New Form" and "- Junior School". Not one of them was a name.
  //
  // A guard exists to catch what the masker MISSED. Complaining about text the masker never
  // claimed is not strictness, it is a false alarm — and one firing on 45% of normal mail is a
  // guard somebody turns off, which costs the real catches too.
  check(new RegExp(`[-–—]\\s+${NAME_RUN}(?=\\s*[(«]|\\s*$)`, 'm'), 'name-after-dash');
  return hits;
}

/** Everything that must be gone before text leaves this machine. */
export function residualPersonalData(text: string): string[] {
  return [...residualPii(text), ...residualNames(text)];
}
