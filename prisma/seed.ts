// prisma/seed.ts — SYNTHETIC seed, shaped from the 2026-08-05 analysis of 190 real
// conversations. Proportions, channel mix, category mix and the 7 July cluster are
// deliberately faithful so the numbers on screen match the numbers in the briefing deck.
//
// NO REAL PARENT, CHILD OR STAFF DATA. Families are "Family 01".."Family 34"; staff are
// role-named fictional accounts on @fountainhead.test.

import { PrismaClient } from '@prisma/client';
import { appSubmission } from '../core/app-rail';
import { getClassifier, looksLikeSwitchboard } from '../core/classify';
import { detectClusters } from '../core/coordination';
import { derivedSeriousness } from '../core/permissions';
import { clockStart, slaDue } from '../core/sla';
import type { Urgency } from '../core/taxonomy';

const db = new PrismaClient();
const classifier = getClassifier('rules');

// Demo anchor. The 7 July cluster sits at its real date; "today" carries a live queue.
const TODAY = new Date('2026-08-05T00:00:00Z');
const ist = (dayOffset: number, h: number, m = 0) =>
  new Date(+TODAY + dayOffset * 864e5 + (h * 60 + m - 330) * 60_000);

const CAMPUSES = [
  { code: 'fsk', name: 'Fountainhead School, Kunkni (Surat)' },
  { code: 'fwgs', name: 'Fountainhead Wockhardt Global School' },
  { code: 'fsm', name: 'Fountainhead School, Malgama' },
  { code: 'falh', name: 'Fountainhead Avadh Learning Hub' },
];

const STAFF = [
  { id: 's-founder', email: 'founder@fountainhead.test', name: 'A Founder', roleLabel: 'Founder', scope: 'group', isLeadership: true },
  { id: 's-hos', email: 'hos@fountainhead.test', name: 'Head of School', roleLabel: 'Head of School', scope: 'group', isLeadership: true },
  { id: 's-pro', email: 'pro@fountainhead.test', name: 'PRO / Communications', roleLabel: 'PRO', scope: 'group', isLeadership: true },
  { id: 's-safe', email: 'safeguarding@fountainhead.test', name: 'Safeguarding Lead', roleLabel: 'Safeguarding Lead', scope: 'group', isLeadership: true },
  { id: 's-transport', email: 'operator@transport.test', name: 'Transport Operator', roleLabel: 'Transport Operator (vendor)', scope: 'group', isVendor: true },
  { id: 's-fd-fsk', email: 'frontdesk.fsk@fountainhead.test', name: 'Front Desk — FSK', roleLabel: 'Front Desk', scope: 'fsk' },
  { id: 's-lead-fsk', email: 'lead.fsk@fountainhead.test', name: 'Campus Lead — FSK', roleLabel: 'Campus Lead', scope: 'fsk' },
  { id: 's-fd-fwgs', email: 'frontdesk.fwgs@fountainhead.test', name: 'Front Desk — FWGS', roleLabel: 'Front Desk', scope: 'fwgs' },
  { id: 's-lead-fwgs', email: 'lead.fwgs@fountainhead.test', name: 'Campus Lead — FWGS', roleLabel: 'Campus Lead', scope: 'fwgs' },
  { id: 's-fd-fsm', email: 'frontdesk.fsm@fountainhead.test', name: 'Front Desk — FSM', roleLabel: 'Front Desk', scope: 'fsm' },
  { id: 's-fd-falh', email: 'frontdesk.falh@fountainhead.test', name: 'Front Desk — FALH', roleLabel: 'Front Desk', scope: 'falh' },
  { id: 's-accounts', email: 'accounts@fountainhead.test', name: 'Accounts', roleLabel: 'Accounts', scope: 'group' },
];

// QM-D9/D26 (2026-08-07): the capability grants every checkpoint now reads. `isLeadership`
// survives ONLY as seed shorthand for "grant ['oversight']" — core/permissions.ts makes
// 'oversight' imply every action EXCEPT 'view_safeguarding'. That one is a NAMED grant
// (R3-4 shape) and goes to exactly ONE person, the Safeguarding Lead, so the demo can show
// an oversight holder — the Founder — being refused a Tier-2 record.
const DESK_GRANTS = ['view_queue', 'file', 'assign', 'resolve'];
const grantsFor = (s: (typeof STAFF)[number]): string[] => {
  if (s.id === 's-safe') return ['oversight', 'view_safeguarding']; // the one named holder
  if (s.isLeadership) return ['oversight'];
  if (s.roleLabel === 'Campus Lead') return [...DESK_GRANTS, 'triage_approve']; // the desk's second pair of eyes (QM-D10)
  if (s.roleLabel === 'Front Desk') return DESK_GRANTS;
  // Vendor + Accounts: they handle what is routed to them and file nothing. For the vendor,
  // 'resolve' is owner-scoped by the R3-23 rule in can() — own requests only.
  return ['view_queue', 'resolve'];
};

type Spec = {
  campus: string;
  channel: 'email' | 'call' | 'whatsapp' | 'walkin' | 'staff' | 'event';
  subject: string;
  body: string;
  at: Date;
  family?: number;
  to?: string[];
  /** The raw From: address (email channel only). Defaults to the family's synthetic address;
   *  noise specs set their own vendor-shaped one. Always a .test/.invalid domain — never real. */
  from?: string;
  status?: 'unfiled' | 'open' | 'waiting' | 'resolved' | 'not_a_request';
  owner?: string;
  repliedAfterMin?: number;
  resolvedAfterMin?: number;
  /** Force a category (a human already triaged it). Otherwise the classifier suggests. */
  category?: string;
  // Fields the desk records in its Daily Call Log.
  routedTo?: string;
  relationship?: string;
  grade?: string;
  section?: string;
  /** QM-D33: staff this complaint is ABOUT — excluded from the record's audience entirely. */
  about?: string[];
  /** A named-person conversation already held (Activity kind 'conveyed') — the QM-D33 route. */
  conveyed?: { actor: string; with: string; note: string; afterMin: number };
};

const FOUNDER_CC = ['founder@fountainhead.test', 'directors@fountainhead.test'];
/** The monitored desk address per campus — the default recipient for an email spec that
 *  doesn't state its own, so every email row carries "arrived at" provenance like real
 *  ingested mail does (2026-08-24 round; lib/ingest/run.ts always records recipients). */
const DESK_ADDR: Record<string, string> = {
  fsk: 'frontdesk@fsksurat.test',
  fwgs: 'frontdesk@fwgs.test',
  fsm: 'frontdesk@fsmsurat.test',
  falh: 'frontdesk@falh.test',
};
const DESK_FSK = [DESK_ADDR.fsk];
const famEmail = (n: number) => `family${String(n).padStart(2, '0')}@example.test`;

// ---------------------------------------------------------------------------------------
// 1. THE 7 JULY CLUSTER — the anchor story. Thirteen conversations, one decision.
//    Four carry a templated subject; two of those pasted the "Subject:" label.
// ---------------------------------------------------------------------------------------
const TEMPLATED = 'Request for Timely Decision-Making During Heavy Rainfall';
const julySeven: Spec[] = [
  { campus: 'fsk', channel: 'email', subject: TEMPLATED, body: 'We request the school to decide on closure earlier when a red alert has been issued. Parents cannot plan the morning otherwise.', at: ist(-29, 8, 27), family: 1, to: [...FOUNDER_CC, ...DESK_FSK], status: 'resolved', owner: 's-founder', repliedAfterMin: 106, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: TEMPLATED, body: 'We request the school to decide on closure earlier when a red alert has been issued. Parents cannot plan the morning otherwise.', at: ist(-29, 8, 35), family: 2, to: [...FOUNDER_CC], status: 'resolved', owner: 's-founder', repliedAfterMin: 98, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: `Subject: ${TEMPLATED}`, body: 'We request the school to decide on closure earlier when a red alert has been issued.', at: ist(-29, 8, 41), family: 3, to: [...FOUNDER_CC, ...DESK_FSK], status: 'resolved', owner: 's-founder', repliedAfterMin: 92, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: `Subject: ${TEMPLATED}`, body: 'We request the school to decide on closure earlier when a red alert has been issued.', at: ist(-29, 8, 50), family: 4, to: [...FOUNDER_CC], status: 'resolved', owner: 's-founder', repliedAfterMin: 83, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: 'Red alert', body: 'Why is school open today when there is a red alert?', at: ist(-29, 8, 20), family: 5, to: [...FOUNDER_CC], status: 'resolved', owner: 's-founder', repliedAfterMin: 120, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: 'School holiday decision', body: 'Please communicate the holiday decision by 6am in future.', at: ist(-29, 8, 30), family: 6, to: [...DESK_FSK], status: 'resolved', owner: 's-lead-fsk', repliedAfterMin: 110, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: 'Declaration of holiday due to heavy rainfall', body: 'Other schools declared a holiday last night. We did not hear from you until the buses had left.', at: ist(-29, 8, 45), family: 7, to: [...FOUNDER_CC, ...DESK_FSK], status: 'resolved', owner: 's-founder', repliedAfterMin: 95, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: '7 July fiasco', body: 'I am writing to express my displeasure at the total lack of consideration with regard to the school being operational in spite of clear advisories.', at: ist(-29, 8, 50), family: 8, to: [...FOUNDER_CC, ...DESK_FSK], status: 'resolved', owner: 's-founder', repliedAfterMin: 83, resolvedAfterMin: 420, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: 'Re: Timely decision', body: 'Following up on my earlier note about the decision timing.', at: ist(-29, 9, 2), family: 9, to: [...FOUNDER_CC], status: 'resolved', owner: 's-founder', repliedAfterMin: 70, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'email', subject: 'Request for Early Intimation During Red Alert - Rural School Closure at Principal’s Discretion', body: 'Rural campuses should be able to close at the principal’s discretion.', at: ist(-29, 9, 10), family: 10, to: [...FOUNDER_CC], status: 'resolved', owner: 's-hos', repliedAfterMin: 88, resolvedAfterMin: 300, category: 'weather-closure' },
  { campus: 'fsk', channel: 'call', subject: 'Called about the rain closure', body: 'Parent called to ask whether buses would run. Told them a decision was expected by 9am.', at: ist(-29, 8, 15), family: 11, status: 'resolved', owner: 's-fd-fsk', repliedAfterMin: 1, resolvedAfterMin: 5, category: 'weather-closure' },
  { campus: 'fsk', channel: 'whatsapp', subject: 'Asked on WhatsApp whether school is open', body: 'Message in the community group asking if school is open. Answered in the group.', at: ist(-29, 8, 25), family: 12, status: 'resolved', owner: 's-fd-fsk', repliedAfterMin: 4, resolvedAfterMin: 10, category: 'weather-closure' },
  // Two unrelated the same day — the cluster detector must not swallow them.
  { campus: 'fsk', channel: 'email', subject: 'School cricket team', body: 'Query about the cricket team announcement.', at: ist(-29, 9, 30), family: 13, to: [...DESK_FSK], status: 'resolved', owner: 's-fd-fsk', repliedAfterMin: 200, resolvedAfterMin: 600, category: 'selection' },
  { campus: 'fsk', channel: 'email', subject: 'Bias in selections', body: 'We feel the selection process for the team was not fair or transparent.', at: ist(-29, 10, 5), family: 14, to: [...FOUNDER_CC], status: 'resolved', owner: 's-lead-fsk', repliedAfterMin: 340, resolvedAfterMin: 2880, category: 'selection' },
];

// ---------------------------------------------------------------------------------------
// 2. TODAY'S LIVE QUEUE — including a cluster forming this morning, so coordination
//    detection demos live rather than only historically.
// ---------------------------------------------------------------------------------------
const UNIFORM_TEMPLATE = 'Concern Regarding the Revised Uniform Policy';
const today: Spec[] = [
  { campus: 'fsk', channel: 'email', subject: UNIFORM_TEMPLATE, body: 'We object to the revised uniform policy announced yesterday. It was not consulted on.', at: ist(0, 7, 12), family: 15, to: [...DESK_FSK, ...FOUNDER_CC] },
  { campus: 'fsk', channel: 'email', subject: `Subject: ${UNIFORM_TEMPLATE}`, body: 'We object to the revised uniform policy announced yesterday. It was not consulted on.', at: ist(0, 7, 26), family: 16, to: [...FOUNDER_CC] },
  { campus: 'fsk', channel: 'email', subject: UNIFORM_TEMPLATE, body: 'We object to the revised uniform policy announced yesterday.', at: ist(0, 7, 41), family: 17, to: [...DESK_FSK] },
  { campus: 'fsk', channel: 'whatsapp', subject: 'Asked about the new uniform rule', body: 'Message in the class group asking whether shorts are still allowed.', at: ist(0, 7, 55), family: 18 },

  // Safeguarding — critical, and (as in the real corpus) transport-related.
  { campus: 'fwgs', channel: 'email', subject: 'Serious concern: child left unattended at the bus stop', body: 'Nobody was there to receive my child at the stop this morning. This is the second time.', at: ist(0, 7, 5), family: 19, to: [...FOUNDER_CC, 'transport@operator.test'] },

  { campus: 'fwgs', channel: 'call', subject: 'Called about a bus running late', body: 'Bus 7 was 40 minutes late and no message was sent. Promised to check with the operator and call back.', at: ist(0, 8, 20), family: 20 },
  { campus: 'fsk', channel: 'walkin', subject: 'Collected a fee receipt at the desk', body: 'Parent came for a duplicate receipt. Printed and handed over.', at: ist(0, 8, 40), family: 21, status: 'resolved', owner: 's-fd-fsk', repliedAfterMin: 1, resolvedAfterMin: 2 },

  // Switchboard traffic. The real Daily Call Log shows 48% of calls are "connect me to Ms X"
  // or "ask her to call back", and 53% were handled by the desk itself. A seed without these
  // under-represents the desk's actual day by half.
  { campus: 'fsk', channel: 'call', subject: 'Mother wanted to speak to the class teacher', body: 'Wanted to discuss last week’s assessment. Class teacher was in a lesson; took a message.', at: ist(0, 8, 5), family: 1, routedTo: 's-lead-fsk', status: 'open', relationship: 'mother', grade: 'Grade 4', section: 'Freedom' },
  { campus: 'fsk', channel: 'call', subject: 'Asked to connect to the coordinator about the trip', body: 'Passed the message on; coordinator to call back before lunch.', at: ist(0, 8, 52), family: 2, routedTo: 's-lead-fsk', status: 'open', relationship: 'father', grade: 'Grade 6', section: 'Conjecture' },
  { campus: 'fsk', channel: 'call', subject: 'Please ask the HRT to call back', body: 'Mother could not reach the homeroom teacher on the app.', at: ist(0, 9, 20), family: 3, routedTo: 's-fd-fsk', status: 'open', relationship: 'mother', grade: 'Grade 2', section: 'Invent' },
  { campus: 'fwgs', channel: 'call', subject: 'Wants to talk to accounts about the instalment', body: 'Transferred; accounts will confirm the schedule.', at: ist(0, 9, 40), family: 4, routedTo: 's-accounts', status: 'open', relationship: 'father', grade: 'Grade 9', section: 'Aspire' },
  { campus: 'fsk', channel: 'call', subject: 'Parcel sent', body: 'Father informed a parcel was sent for the child. Nothing pending.', at: ist(0, 10, 10), family: 5, status: 'resolved', owner: 's-fd-fsk', repliedAfterMin: 1, resolvedAfterMin: 1, relationship: 'father', grade: 'Grade 12', section: 'Poise' },
  { campus: 'fsk', channel: 'staff', subject: 'Parent asked a teacher about the trip form', body: 'A parent stopped me in the corridor asking when the field trip form is due.', at: ist(0, 9, 5), family: 22 },
  { campus: 'fsm', channel: 'email', subject: 'Request for Continuation of Monthly Fee Installment Facility', body: 'We would like to continue paying monthly rather than quarterly this year.', at: ist(0, 9, 15), family: 23, to: ['accounts@fountainhead.test'] },
  { campus: 'fwgs', channel: 'email', subject: 'HUGE SHOUTOUT TO THE BEST SCHOOL', body: 'Thank you to the whole team for how you handled sports day. We are grateful.', at: ist(0, 9, 30), family: 24, to: [...DESK_FSK] },
  { campus: 'falh', channel: 'email', subject: 'Portfolio photo upload issues', body: 'The parent portal will not let me upload the photo. I get an error every time.', at: ist(0, 9, 45), family: 25 },
  { campus: 'fsk', channel: 'email', subject: 'I am facing problem', body: 'Cannot log in to the app since yesterday. Password reset does not arrive.', at: ist(0, 10, 0), family: 26, to: [...DESK_FSK] },
  { campus: 'fsm', channel: 'email', subject: 'Request', body: 'Please let me know the procedure.', at: ist(0, 10, 20), family: 27 },
  { campus: 'falh', channel: 'event', subject: 'Raised at PTI: reading challenge feedback', body: 'Parent at PTI felt the Early Years reading challenge is too competitive.', at: ist(-1, 15, 30), family: 28 },
  { campus: 'fwgs', channel: 'email', subject: 'Missing bat', body: 'My son has lost his cricket bat somewhere at school.', at: ist(-1, 11, 0), family: 29 },
  { campus: 'fsk', channel: 'email', subject: 'Request for Medical Leave and Academic Accommodations', body: 'My daughter needs two weeks of medical leave after surgery. What accommodations are possible?', at: ist(-1, 9, 0), family: 30, status: 'open', owner: 's-fd-fsk' },
  { campus: 'fwgs', channel: 'email', subject: 'FSK moving away from its policy of 20 students in a class', body: 'We chose the school for small class sizes. Class strength is now 26.', at: ist(-2, 10, 0), family: 31, to: [...FOUNDER_CC], status: 'open', owner: 's-hos' },
  { campus: 'fsm', channel: 'email', subject: 'Urgent: repeated harassment on the school bus', body: 'My child reports being bullied on the bus repeatedly. We want immediate action.', at: ist(-3, 8, 10), family: 32, to: [...FOUNDER_CC], status: 'open', owner: 's-safe' },
  { campus: 'fsk', channel: 'email', subject: 'Gratitude Note', body: 'Thank you for the support during the exam period. It made a real difference.', at: ist(-4, 12, 0), family: 33, status: 'resolved', owner: 's-pro', repliedAfterMin: 180, resolvedAfterMin: 200 },

  // QM-D32/D33 exemplar: a complaint ABOUT a staff member who is also a selectable demo
  // persona — switch "Acting as" to Campus Lead — FSK and the exclusion demos live: the queue
  // row disappears (suppress-the-row), the record URL refuses with rule 0's reason, and the
  // owner picker refuses them (QM-D32). Owned by the Head of School; one 'conveyed' leg is
  // already on the trail — the only route by which the substance reached the named person.
  { campus: 'fsk', channel: 'email', subject: 'Concern about how the Grade 5 production was cast', body: 'We are unhappy with how the campus lead handled the casting for the Grade 5 production. Parts were promised to the children and then reallocated without any explanation.', at: ist(-1, 10, 30), family: 6, to: [...DESK_FSK], status: 'open', owner: 's-hos', category: 'selection', about: ['s-lead-fsk'], conveyed: { actor: 's-hos', with: 's-lead-fsk', note: 'shared the substance of the concern; agreed the casting rubric will be published to families next term.', afterMin: 240 } },
  { campus: 'falh', channel: 'email', subject: 'New Bus-stop request !!', body: 'Could a stop be added near our society? Three families would use it.', at: ist(-5, 9, 0), family: 34, status: 'open', owner: 's-transport' },
];

// ---------------------------------------------------------------------------------------
// 3. VENDOR NOISE — about half of real inbound at the public address. Lands unfiled and
//    the classifier keeps it out of the working queue.
// ---------------------------------------------------------------------------------------
const noise: Spec[] = [
  { campus: 'fsk', channel: 'email', subject: 'India School Rankings Awards 2025-26', body: 'Claim your ranking trophy. Our rankings survey is attached. Book a demo of our platform.', at: ist(0, 6, 10), from: 'awards@india-rankings.test' },
  { campus: 'fsk', channel: 'email', subject: 'Invitation to Speak at the National Summit on AI in Education', body: 'We would be honoured to have you speak. Please find the proposal attached.', at: ist(0, 6, 30), from: 'speakers@edu-summit.test' },
  { campus: 'fsk', channel: 'email', subject: 'Transforming Assessments with Classwise AI', body: 'Introducing our platform for schools. Book a demo today. Pricing attached.', at: ist(0, 6, 45), from: 'sales@classwise-ai.test' },
  { campus: 'fsk', channel: 'email', subject: 'Proposal for International Educational Tours for Students', body: 'Our proposal for student tours, with a brochure and pricing.', at: ist(-1, 14, 0), from: 'proposals@edu-tours.test' },
  { campus: 'fsk', channel: 'email', subject: 'Exclusive Feature of your school for the India’s Greatest Brands', body: 'An exclusive feature opportunity. Partnership pricing available.', at: ist(-1, 16, 0), from: 'features@greatest-brands.test' },
  { campus: 'fsk', channel: 'email', subject: 'Invitation to the 5th Edition of the Mental Math World Cup', body: 'Elevate your students. Register now — empanel your school.', at: ist(-2, 11, 0), from: 'invite@mentalmath-cup.test' },
  { campus: 'fsk', channel: 'email', subject: 'CorelDRAW Software Compliance', body: 'Our records indicate a licence compliance review is due. Pricing for renewal attached.', at: ist(-2, 15, 0), from: 'compliance@licence-renewals.test' },
  { campus: 'fsk', channel: 'email', subject: 'Application for HR Position — Vapi Campus', body: 'Please find my resume attached for the advertised vacancy.', at: ist(-3, 10, 0), from: 'jobseeker.applicant@example.test' },
  { campus: 'fwgs', channel: 'email', subject: 'Respond Right Smart School Proposal', body: 'Introducing our programme. Book a demo. Brochure attached.', at: ist(-3, 13, 0), from: 'hello@respond-right.test' },
  { campus: 'fsk', channel: 'email', subject: 'SubjectNexus: an academic coordination platform', body: 'Our platform for academic coordination. Free trial account available.', at: ist(-4, 9, 0), from: 'team@subjectnexus.test' },
];

const ALL: Spec[] = [...julySeven, ...today, ...noise];

async function main() {
  console.log('Clearing…');
  await db.activity.deleteMany();
  await db.requestMessage.deleteMany();
  // The mailbox record goes with the requests it describes: ledger rows key on the demo
  // fixtures' stable Message-IDs, so stale rows would block the same fixtures from ever
  // re-recording; and IngestRun.actorId references Staff, which is cleared below.
  await db.mailLedgerEntry.deleteMany();
  await db.ingestRun.deleteMany();
  await db.request.deleteMany();
  await db.cluster.deleteMany();
  await db.family.deleteMany();
  await db.staff.deleteMany();
  await db.orgUnit.deleteMany();

  console.log('Org tree…');
  await db.orgUnit.create({
    data: { id: 'group', parentId: null, type: 'GROUP', code: 'group', name: 'Fountainhead Education Trust' },
  });
  for (const c of CAMPUSES) {
    await db.orgUnit.create({
      data: { id: c.code, parentId: 'group', type: 'CAMPUS', code: c.code, name: c.name },
    });
  }

  console.log('Staff…');
  for (const s of STAFF) {
    await db.staff.create({
      data: {
        id: s.id, email: s.email, name: s.name, roleLabel: s.roleLabel,
        scopeOrgUnitId: s.scope, isLeadership: Boolean(s.isLeadership), isVendor: Boolean(s.isVendor),
        permissions: grantsFor(s),
      },
    });
  }

  console.log('Families…');
  const campusOf = (n: number) => CAMPUSES[n % CAMPUSES.length].code;
  for (let i = 1; i <= 34; i++) {
    await db.family.create({
      data: {
        id: `f-${i}`,
        label: `Family ${String(i).padStart(2, '0')}`,
        emailKey: `family${String(i).padStart(2, '0')}@example.test`,
        campusOrgUnitId: campusOf(i),
        phones: { create: [{ id: `f-${i}-phone`, phoneKey: `98${String(70000000 + i * 137).slice(0, 8)}` }] },
      },
    });
  }

  console.log(`Requests (${ALL.length})…`);
  let n = 0;
  for (const spec of ALL) {
    n += 1;
    const ref = `FD-${String(n).padStart(4, '0')}`;
    const sug = classifier.classify({
      subject: spec.subject,
      body: spec.body,
      senderIsKnownFamily: spec.family !== undefined,
    });

    const category = spec.category ?? (spec.status && spec.status !== 'unfiled' ? sug.category : null);
    const urgency: Urgency = sug.urgency;
    const status = spec.status ?? (sug.isVendorNoise ? 'unfiled' : 'unfiled');
    const sb = looksLikeSwitchboard(`${spec.subject} ${spec.body}`);
    const start = clockStart(spec.at);
    const due = slaDue(spec.at, urgency);

    const firstReplyAt = spec.repliedAfterMin != null
      ? new Date(+spec.at + spec.repliedAfterMin * 60_000) : null;
    const resolvedAt = spec.resolvedAfterMin != null
      ? new Date(+spec.at + spec.resolvedAfterMin * 60_000) : null;

    await db.request.create({
      data: {
        id: `r-${n}`, ref,
        channel: spec.channel,
        campusOrgUnitId: spec.campus,
        familyId: spec.family ? `f-${spec.family}` : null,
        subject: spec.subject,
        body: spec.body,
        // Email rows always carry provenance, like real ingested mail: an unstated recipient
        // means "the campus desk address", and an unstated sender means the family's own
        // synthetic address. Non-email channels have neither — there is no envelope.
        originalRecipients: spec.channel === 'email' ? (spec.to ?? [DESK_ADDR[spec.campus]]) : (spec.to ?? []),
        senderEmail: spec.channel === 'email' ? (spec.from ?? (spec.family ? famEmail(spec.family) : null)) : null,
        arrivedAt: spec.at,
        clockStartsAt: start,
        category,
        urgency,
        status,
        suggestedCategory: sug.category,
        suggestedUrgency: sug.urgency,
        suggestionReason: sug.reason,
        isVendorNoise: sug.isVendorNoise,
        isSafeguarding: sug.isSafeguarding,
        // QM-D10: anything seeded as already-filed carries the seriousness fileRequest would
        // have recorded, and no approval — so the pending-second-look chip demos on the live
        // safeguarding/critical items rather than only after a fresh filing.
        seriousness: category ? derivedSeriousness({ urgency, isSafeguarding: sug.isSafeguarding }) : null,
        ownerId: spec.routedTo ?? spec.owner ?? null,
        receivedById: spec.channel === 'email' ? null : 's-fd-' + spec.campus,
        routedToId: spec.routedTo ?? null,
        callerRelationship: spec.relationship ?? null,
        grade: spec.grade ?? null,
        section: spec.section ?? null,
        isSwitchboard: sb.yes,
        aboutStaffIds: spec.about ?? [],
        slaDueAt: sug.isVendorNoise ? null : due,
        firstReplyAt,
        resolvedAt,
        messages: {
          create: [
            {
              id: `m-${n}-1`, direction: 'in',
              senderLabel: spec.family ? `Family ${String(spec.family).padStart(2, '0')}` : 'External sender',
              at: spec.at, body: spec.body,
            },
            ...(firstReplyAt ? [{
              id: `m-${n}-2`, direction: 'out',
              senderLabel: STAFF.find(s => s.id === spec.owner)?.name ?? 'Front Desk',
              at: firstReplyAt,
              body: 'Thank you for writing in. We have looked into this and will confirm the outcome.',
            }] : []),
          ],
        },
        activities: {
          create: [
            { id: `a-${n}-1`, at: spec.at, kind: 'filed', detail: `Arrived via ${spec.channel}.` },
            { id: `a-${n}-2`, at: spec.at, kind: 'classified', detail: `Suggested "${sug.category}" (${sug.confidence} confidence) — ${sug.reason}` },
            ...(spec.owner ? [{ id: `a-${n}-3`, at: new Date(+spec.at + 60_000), actorId: spec.owner, kind: 'assigned', detail: `Owner set to ${STAFF.find(s => s.id === spec.owner)?.name}.` }] : []),
            ...(resolvedAt ? [{ id: `a-${n}-4`, at: resolvedAt, actorId: spec.owner ?? null, kind: 'resolved', detail: 'Marked resolved.' }] : []),
            // The QM-D33 marking + conveyed legs, worded exactly as markAboutStaff and
            // recordConveyed (app/actions.ts) word them, so the seeded trail matches a live one.
            ...(spec.about ?? []).map((sid, i) => ({
              id: `a-${n}-ab${i + 1}`, at: new Date(+spec.at + 30 * 60_000), actorId: spec.owner ?? null,
              kind: 'note',
              detail: `Marked as concerning ${STAFF.find(s => s.id === sid)?.name} — excluded from this record's audience (QM-D33).`,
            })),
            ...(spec.conveyed ? [{
              id: `a-${n}-cv`, at: new Date(+spec.at + spec.conveyed.afterMin * 60_000), actorId: spec.conveyed.actor,
              kind: 'conveyed',
              detail: `Spoke with ${STAFF.find(s => s.id === spec.conveyed?.with)?.name} — ${spec.conveyed.note}`,
            }] : []),
          ],
        },
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // 4. THE APP RAIL (QM-D34/QM-D35) — two app-channel exemplars for Family 01, shaped by
  //    the SAME pure function the live action uses (core/app-rail.ts appSubmission), so the
  //    seed cannot drift from the behaviour it demos, and with trail legs worded exactly as
  //    the live actions word them. One is open with a two-way thread — the outbound carries
  //    dispatch ['app','email'], the engine's both-rails phasing choice (QM-D35) — and one
  //    is resolved with satisfaction null under a coded absence reason, so the parent face's
  //    rating ask demos live (a late rating fills the null; the absence reason stays as the
  //    closure-time record).
  console.log('App-rail exemplars…');
  {
    // f-1's own campus (campusOf(1) = fwgs): the app rail takes campus from the signed-in
    // family record, never from address inference — there are no addresses to infer from.
    const fam = { id: 'f-1', label: 'Family 01', campus: campusOf(1) };
    const desk = 's-fd-' + fam.campus;
    const deskName = STAFF.find(s => s.id === desk)?.name ?? 'Front Desk';

    // Open, two-way: submitted 08:35 IST today, seen at 09:00, replied at 10:05 (waiting),
    // and the family wrote back at 11:00 — the ball returned to the desk, so it reads open.
    n += 1;
    const atA = ist(0, 8, 35);
    const subA = appSubmission(atA, 'transport', {
      subject: 'Request to shift our bus stop closer to the society gate',
      body: 'The current stop is a ten-minute walk from our society. Could the route pause at the gate instead? Three families here use the same stop.',
    });
    const { suggestionConfidence: confA, ...rowA } = subA;
    const ackA = ist(0, 9, 0);
    const replyA = 'We have asked the transport operator whether the route can pause at the gate, and will confirm by Thursday.';
    const replyAtA = ist(0, 10, 5);
    const backA = 'Thursday works — thank you. Mornings are the harder run for us.';
    const backAtA = ist(0, 11, 0);
    await db.request.create({
      data: {
        id: `r-${n}`, ref: `FD-${String(n).padStart(4, '0')}`,
        ...rowA,
        status: 'open',
        acknowledgedAt: ackA,
        firstReplyAt: replyAtA,
        campusOrgUnitId: fam.campus,
        familyId: fam.id,
        originalRecipients: [],
        ownerId: desk,
        messages: {
          create: [
            { id: `m-${n}-1`, direction: 'in', senderLabel: fam.label, at: atA, body: subA.body },
            { id: `m-${n}-2`, direction: 'out', senderLabel: deskName, at: replyAtA, body: replyA, dispatch: ['app', 'email'] },
            { id: `m-${n}-3`, direction: 'in', senderLabel: fam.label, at: backAtA, body: backA },
          ],
        },
        activities: {
          create: [
            { id: `a-${n}-1`, at: atA, kind: 'filed', detail: `Submitted from the app by ${fam.label} — filed on submission, pre-routed to "${subA.category}" by the family's own menu pick (QM-D34(5)).` },
            { id: `a-${n}-2`, at: atA, kind: 'classified', detail: `Suggested "${subA.suggestedCategory}" (${confA} confidence) — ${subA.suggestionReason}` },
            { id: `a-${n}-2b`, at: ackA, actorId: desk, kind: 'assigned', detail: `Owner set to ${deskName} (Front Desk).` },
            { id: `a-${n}-3`, at: ackA, actorId: desk, kind: 'acknowledged', detail: `${deskName} has seen this — the family is no longer waiting for a first look.` },
            { id: `a-${n}-4`, at: replyAtA, actorId: desk, kind: 'replied', detail: `Replied to the family (${replyA.length} characters) — in-app + email.` },
            { id: `a-${n}-5`, at: backAtA, kind: 'note', detail: `The family replied from the app (${backA.length} characters) — back with the school.` },
          ],
        },
      },
    });

    // Resolved with satisfaction null, closed under 'asked_no_reply' — the parent face shows
    // the 1–5 ask, and a click fills the null exactly as rateResolved does.
    n += 1;
    const atB = ist(-6, 10, 0);
    const subB = appSubmission(atB, 'certificates', {
      subject: 'Bonafide certificate for a visa application',
      body: 'We need a bonafide certificate for our visa application next month. What is the process and how long does it take?',
    });
    const { suggestionConfidence: confB, ...rowB } = subB;
    const ackB = ist(-6, 10, 40);
    const replyB = 'The certificate is ready for collection at the front desk — any weekday between 9 and 4. Please carry your parent ID card.';
    const replyAtB = ist(-6, 13, 0);
    const resolvedAtB = ist(-5, 11, 0);
    await db.request.create({
      data: {
        id: `r-${n}`, ref: `FD-${String(n).padStart(4, '0')}`,
        ...rowB,
        status: 'resolved',
        acknowledgedAt: ackB,
        firstReplyAt: replyAtB,
        resolvedAt: resolvedAtB,
        satisfaction: null,
        satisfactionAbsentReason: 'asked_no_reply',
        campusOrgUnitId: fam.campus,
        familyId: fam.id,
        originalRecipients: [],
        ownerId: desk,
        messages: {
          create: [
            { id: `m-${n}-1`, direction: 'in', senderLabel: fam.label, at: atB, body: subB.body },
            { id: `m-${n}-2`, direction: 'out', senderLabel: deskName, at: replyAtB, body: replyB, dispatch: ['app', 'email'] },
          ],
        },
        activities: {
          create: [
            { id: `a-${n}-1`, at: atB, kind: 'filed', detail: `Submitted from the app by ${fam.label} — filed on submission, pre-routed to "${subB.category}" by the family's own menu pick (QM-D34(5)).` },
            { id: `a-${n}-2`, at: atB, kind: 'classified', detail: `Suggested "${subB.suggestedCategory}" (${confB} confidence) — ${subB.suggestionReason}` },
            { id: `a-${n}-2b`, at: ackB, actorId: desk, kind: 'assigned', detail: `Owner set to ${deskName} (Front Desk).` },
            { id: `a-${n}-3`, at: ackB, actorId: desk, kind: 'acknowledged', detail: `${deskName} has seen this — the family is no longer waiting for a first look.` },
            { id: `a-${n}-4`, at: replyAtB, actorId: desk, kind: 'replied', detail: `Replied to the family (${replyB.length} characters) — in-app + email.` },
            { id: `a-${n}-5`, at: resolvedAtB, actorId: desk, kind: 'resolved', detail: 'Marked resolved. No rating — Asked — no reply.' },
          ],
        },
      },
    });
  }

  console.log('Detecting clusters…');
  // Keep this candidate shape identical to recomputeClustersDb in lib/clusters.ts. That one is
  // 'server-only' so a seed script cannot import it, but the two MUST agree — otherwise seeded
  // demo clusters stop matching what production computes from the same rows.
  const rows = await db.request.findMany({
    where: { isVendorNoise: false, isSwitchboard: false },
    select: {
      id: true, subject: true, arrivedAt: true, campusOrgUnitId: true,
      category: true, suggestedCategory: true, familyId: true, senderEmail: true,
    },
  });
  const clusters = detectClusters(
    rows.map(r => ({
      id: r.id, subject: r.subject, arrivedAt: r.arrivedAt,
      campusOrgUnitId: r.campusOrgUnitId,
      category: r.category ?? r.suggestedCategory,
      originatorKey: r.familyId ?? (r.senderEmail ? r.senderEmail.toLowerCase() : null),
    })),
  );

  let ci = 0;
  for (const c of clusters) {
    ci += 1;
    const id = `c-${ci}`;
    await db.cluster.create({
      data: {
        id, label: c.label, signature: c.signature,
        windowStart: c.windowStart, windowEnd: c.windowEnd,
        isCoordinated: c.isCoordinated, templateHits: c.templateHits,
        campusOrgUnitId: rows.find(r => r.id === c.memberIds[0])?.campusOrgUnitId ?? null,
      },
    });
    await db.request.updateMany({ where: { id: { in: c.memberIds } }, data: { clusterId: id } });
    console.log(`  ${c.kind.padEnd(8)} ${String(c.memberIds.length).padStart(2)} members  coordinated=${c.isCoordinated}  ${c.label.slice(0, 54)}`);
  }

  const counts = {
    requests: await db.request.count(),
    unfiled: await db.request.count({ where: { status: 'unfiled' } }),
    noise: await db.request.count({ where: { isVendorNoise: true } }),
    safeguarding: await db.request.count({ where: { isSafeguarding: true } }),
    clusters: await db.cluster.count(),
    coordinated: await db.cluster.count({ where: { isCoordinated: true } }),
  };
  console.log('\nSeeded:', counts);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
