// core/taxonomy.ts — the categories, derived from the 2026-08-05 analysis of 190 real
// conversations. Counts in the comments are the observed thread counts, kept so nobody
// "tidies" a category away without knowing what it cost to find.
//
// PURE. No I/O, no framework imports.

// 'app' added per QM-D34 (2026-08-07): the locked in-app conversation rail (SD-COM-3) is the
// PRIMARY parent surface — inbound email has no locked capability grant anywhere in the estate.
// An app submission arrives PRE-ROUTED (the parent picks from the deterministic category menu,
// concierge suggest-only), so per QM-D34(5) submission IS filing on this channel.
export const CHANNELS = ['email', 'call', 'whatsapp', 'walkin', 'staff', 'event', 'app'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  call: 'Phone call',
  whatsapp: 'WhatsApp',
  walkin: 'Walk-in',
  staff: 'Via staff',
  event: 'At an event',
  app: 'App',
};

export const URGENCIES = ['low', 'normal', 'high', 'critical'] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * Who was on the phone. Taken verbatim from the FSK Daily Call Log's own column, with the
 * observed counts over 636 real calls — including the two things a fixed list fixes: the
 * misspelled "Alumni Studnent", and "Other" being a 29% catch-all that hides alumni, vendors
 * and students behind one label.
 */
export const CALLER_RELATIONSHIPS = [
  { key: 'mother', label: 'Mother', observed: 329 },
  { key: 'father', label: 'Father', observed: 73 },
  { key: 'guardian', label: 'Other guardian', observed: 0 },
  { key: 'student', label: 'Student', observed: 4 },
  { key: 'alumni', label: 'Alumni', observed: 18 },
  { key: 'vendor', label: 'Vendor / supplier', observed: 11 },
  { key: 'other', label: 'Someone else', observed: 185 },
] as const;

/**
 * The sheet's "Call type" column does two jobs at once: `connected` (257) is an OUTCOME, while
 * Query / Pass on info / HR / Admission / Vendor are TYPES. Split here, because conflating
 * them is why the sheet cannot answer "how many queries did we get" or "how many did we
 * actually connect".
 */
export const CALL_PURPOSES = [
  { key: 'query', label: 'Query', observed: 240 },
  { key: 'pass-on-info', label: 'Pass on information', observed: 52 },
  { key: 'hr', label: 'HR / staff matter', observed: 54 },
  { key: 'admission', label: 'Admission enquiry', observed: 11 },
  { key: 'vendor', label: 'Vendor / supplier', observed: 6 },
] as const;

export const CALL_OUTCOMES = [
  { key: 'connected', label: 'Connected them', observed: 257 },
  { key: 'message-taken', label: 'Took a message', observed: 0 },
  { key: 'answered', label: 'Answered it myself', observed: 0 },
  { key: 'callback-promised', label: 'Promised a call back', observed: 0 },
] as const;

export const STATUSES = ['unfiled', 'open', 'waiting', 'resolved', 'not_a_request'] as const;
export type Status = (typeof STATUSES)[number];

export interface CategoryDef {
  key: string;
  label: string;
  /** Threads observed in the analysed corpus. 0 = anticipated but unseen. */
  observed: number;
  /** Who should own it. Several deliberately do NOT belong to the front desk. */
  ownerHint: string;
  /** Safeguarding categories auto-refer and are Tier-2 (R3-18). */
  safeguarding?: boolean;
  accent: string;
}

export const CATEGORIES: CategoryDef[] = [
  // Certificates and records turned out to be a major real stream the first pass missed:
  // bonafide requests appeared twice in a 30-conversation FSK census, alongside TCs, character
  // certificates, NOCs and ID cards. Ranked high deliberately.
  { key: 'certificates',      label: 'Certificates & records',   observed: 12, ownerHint: 'Records / admin',    accent: 'blue' },
  { key: 'weather-closure',   label: 'Weather & closure',        observed: 11, ownerHint: 'Campus lead',        accent: 'rust' },
  { key: 'praise',            label: 'Praise & achievement',      observed: 8,  ownerHint: 'PRO / marketing',    accent: 'green' },
  { key: 'child-safety',      label: 'Child safety',              observed: 5,  ownerHint: 'Safeguarding lead',  safeguarding: true, accent: 'deepred' },
  { key: 'transport',         label: 'Transport & bus stops',     observed: 5,  ownerHint: 'Transport operator', accent: 'amber' },
  { key: 'selection',         label: 'Selection fairness',        observed: 5,  ownerHint: 'Academics / sport',  accent: 'plum' },
  { key: 'fees',              label: 'Fees & payment',            observed: 5,  ownerHint: 'Accounts',           accent: 'blue' },
  { key: 'leave-medical',     label: 'Leave, medical & attendance', observed: 5, ownerHint: 'Front desk',        accent: 'indigo' },
  { key: 'uniform',           label: 'Uniform & dress',           observed: 4,  ownerHint: 'Front desk',         accent: 'teal' },
  { key: 'academic',          label: 'Academic & assessment',     observed: 4,  ownerHint: 'Academics',          accent: 'indigo' },
  { key: 'meetings',          label: 'Meetings & appointments',   observed: 4,  ownerHint: 'Front desk',         accent: 'teal' },
  { key: 'systems',           label: 'Systems & access',          observed: 4,  ownerHint: 'IT',                 accent: 'plum' },
  { key: 'school-direction',  label: 'School direction',          observed: 3,  ownerHint: 'Head of school',     accent: 'rust' },
  { key: 'food-health',       label: 'Food & health',             observed: 3,  ownerHint: 'Campus lead',        accent: 'green' },
  { key: 'camps-services',    label: 'Camps & optional services', observed: 3,  ownerHint: 'Front desk',         accent: 'amber' },
  { key: 'about-other-parent', label: 'About another family',     observed: 1,  ownerHint: 'Head of school',     accent: 'deepred' },
  { key: 'lost-property',     label: 'Lost property',             observed: 1,  ownerHint: 'Front desk',         accent: 'teal' },
  { key: 'not-a-request',     label: 'Not a parent request',      observed: 64, ownerHint: 'Filtered out',        accent: 'ink' },
  // The honest default. Never guess a category confidently — an item nothing matched must LOOK
  // untriaged so a person picks it up, rather than hiding in a plausible-looking bucket.
  { key: 'unclassified',      label: 'Needs a person to read it', observed: 0,  ownerHint: 'Front desk',         accent: 'ink' },
];

export const CATEGORY_KEYS = CATEGORIES.map(c => c.key);
export const categoryDef = (key: string | null | undefined) =>
  CATEGORIES.find(c => c.key === key);
export const isSafeguardingCategory = (key: string | null | undefined) =>
  Boolean(categoryDef(key)?.safeguarding);

// ---------------------------------------------------------------------------------------
// The parent-facing menu (QM-D34 / SD-COM-3).
//
// SD-COM-3's locked shape: the parent chooses from a DETERMINISTIC category→door list — the
// concierge is suggest-only, and no triage step exists on this rail because the parent's pick
// IS the routing triage performs elsewhere (QM-D34(5): submission is filing). DERIVED from
// CATEGORIES so the two lists can never drift: a category added or retired above changes this
// menu in the same edit, and the subset test (tests/app-rail.test.ts) catches any bypass.
//
// What a parent cannot pick, and why:
//   - 'not-a-request'  — a filter's verdict on machine/vendor mail, not a door.
//   - 'unclassified'   — the CLASSIFIER's honest default. A parent always knows what their
//                        own message is about, so "needs a person to read it" would be a
//                        confusing null choice, not a door.
// 'child-safety' stays ON the menu deliberately: a parent must be able to walk through the
// safety door directly, and the rail auto-refers it (R3-18) exactly as any channel would.
// ---------------------------------------------------------------------------------------

export const PARENT_EXCLUDED_KEYS = ['not-a-request', 'unclassified'] as const;

/**
 * Softer phrasing for the parent face. Keys stay the staff keys — one taxonomy, two voices —
 * and any category without an override falls back to its staff label, so a new category is
 * never silently missing from the menu while it waits for a friendlier name.
 */
const PARENT_LABELS: Record<string, string> = {
  certificates: 'A certificate or document',
  'weather-closure': 'Weather & closure decisions',
  praise: 'A thank-you or good news',
  'child-safety': 'My child’s safety',
  transport: 'Bus, stop or route',
  selection: 'Team or activity selection',
  fees: 'Fees & payments',
  'leave-medical': 'Leave, medical or attendance',
  uniform: 'Uniform & dress',
  academic: 'Learning & assessment',
  meetings: 'A meeting or appointment',
  systems: 'App or portal trouble',
  'school-direction': 'A school-level decision',
  'food-health': 'Food & health',
  'camps-services': 'Camps & optional services',
  'about-other-parent': 'About another family',
  'lost-property': 'Lost property',
};

export interface ParentMenuItem {
  key: string;
  label: string;
}

export const PARENT_MENU: ParentMenuItem[] = CATEGORIES.filter(
  c => !(PARENT_EXCLUDED_KEYS as readonly string[]).includes(c.key),
).map(c => ({ key: c.key, label: PARENT_LABELS[c.key] ?? c.label }));

export const isParentCategory = (key: string | null | undefined) =>
  PARENT_MENU.some(m => m.key === key);
