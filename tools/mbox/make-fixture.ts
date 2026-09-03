// tools/mbox/make-fixture.ts — generate a SYNTHETIC mbox shaped like the real front-desk
// archive, so the analyser can be smoke-tested before the Takeout export lands.
//
//   npx tsx tools/mbox/make-fixture.ts [out.mbox]
//
// Shape is drawn from the 2026-08-05 census: ~57% machine-opened, one huge rolling report
// thread, a templated coordinated cluster, some parent threads answered and some not,
// Marathi in one circular, and heavy recipient sprawl. No real data — all names invented.

import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'fixture.mbox';
const L: string[] = [];
let seq = 0;
// Counted separately from `seq`: a message created with an explicit id never bumps seq, so
// the id counter under-reports by one per rolling-thread opener.
let count = 0;

const CHILD = ['Aarav Mehta', 'Diya Shah', 'Kabir Patel', 'Myra Joshi', 'Vivaan Desai',
               'Anika Rao', 'Reyansh Gupta', 'Saanvi Nair', 'Aditya Bose', 'Ishani Kaur'];
const slug = (n: string) => n.toLowerCase().replace(/\s+/g, '.');

const iso = (d: Date) => d.toUTCString().replace('GMT', '+0000');

function msg(o: {
  fromName: string; fromAddr: string; subject: string; date: Date; body: string;
  to?: string[]; inReplyTo?: string; id?: string; html?: boolean; qp?: boolean;
}) {
  const id = o.id ?? `<m${++seq}@fixture.test>`;
  count++;
  // Classic mbox separator: "From addr Wed Jul  1 14:30:00 2026" — day NAME, month NAME,
  // day NUMBER, time, year, in that order.
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][o.date.getUTCDay()];
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][o.date.getUTCMonth()];
  const hh = String(o.date.getUTCHours()).padStart(2, '0');
  const mm = String(o.date.getUTCMinutes()).padStart(2, '0');
  L.push(`From ${o.fromAddr} ${D} ${M} ${String(o.date.getUTCDate()).padStart(2, ' ')} ${hh}:${mm}:00 ${o.date.getUTCFullYear()}`);
  L.push(`Message-ID: ${id}`);
  L.push(`From: "${o.fromName}" <${o.fromAddr}>`);
  L.push(`To: ${(o.to ?? ['frontdesk@fsksurat.in']).join(', ')}`);
  L.push(`Subject: ${o.subject}`);
  L.push(`Date: ${iso(o.date)}`);
  if (o.inReplyTo) L.push(`In-Reply-To: ${o.inReplyTo}`);
  if (o.html) {
    L.push('Content-Type: multipart/alternative; boundary="BX"');
    L.push('');
    L.push('--BX');
    L.push('Content-Type: text/plain; charset=UTF-8');
    if (o.qp) L.push('Content-Transfer-Encoding: quoted-printable');
    L.push('');
    L.push(o.qp ? o.body.replace(/ /g, '=20') : o.body);
    L.push('--BX');
    L.push('Content-Type: text/html; charset=UTF-8');
    L.push('');
    L.push(`<div>${o.body}</div>`);
    L.push('--BX--');
  } else {
    L.push('Content-Type: text/plain; charset=UTF-8');
    L.push('');
    L.push(o.body);
  }
  L.push('');
  return id;
}

const day = (n: number, h = 9, m = 0) => new Date(Date.UTC(2026, 6, n, h - 5, m - 30));

// --- 1. the rolling missed-call report: one thread, 300 messages, ~10 months --------------
const rollId = '<rolling-missedcall@fixture.test>';
msg({ fromName: 'Enjay Synapse', fromAddr: 'reports@enjay.test', id: rollId,
      subject: 'frontdesk missed call report', date: day(1, 20),
      body: 'Call Date Source Destination Disposition\n2026-07-01 14:37 09900000001 missed' });
for (let i = 1; i < 300; i++) {
  msg({ fromName: 'Enjay Synapse', fromAddr: 'reports@enjay.test', inReplyTo: rollId,
        subject: 'Re: frontdesk missed call report',
        date: new Date(+day(1, 20) + i * 864e5),
        body: `Call Date Source Destination Disposition\nrow ${i} 09900000001 missed` });
}

// --- 2. machine notification streams ------------------------------------------------------
for (let i = 0; i < 90; i++) {
  const c = CHILD[i % CHILD.length];
  msg({ fromName: 'Student Exit Pass', fromAddr: 'forms-receipts@fsksurat.in',
        subject: `Student Exit Pass - New Form filled for ${c} (Grade ${(i % 12) + 1} - Zeta) (FSK20993${String(i).padStart(2, '0')})`,
        date: day(2 + (i % 25), 10 + (i % 8), i % 60),
        body: `Student Exit Pass Notification - ${c}. Dear PCs/FrontDesk/ THIS EMAIL IS GENERATED automatically.` });
}
for (let i = 0; i < 40; i++) {
  const c = CHILD[i % CHILD.length];
  msg({ fromName: 'Nucleus-Sickbay visit - student', fromAddr: 'donotreply@fsksurat.in',
        subject: `${c} has visited sickbay.`, date: day(2 + (i % 25), 13, i % 60),
        body: 'Dear TL/ HRT, Kindly go through the details given below. Sickbay visit details' });
}
for (let i = 0; i < 25; i++) {
  msg({ fromName: 'Nucleus-ICard', fromAddr: 'donotreply@fsksurat.in',
        subject: `ID Card update request for ${CHILD[i % CHILD.length]}`,
        date: day(3 + (i % 20), 15, i), body: 'Dear Front Desk, Parent has added ID Card update request' });
}
for (let i = 0; i < 30; i++) {
  msg({ fromName: 'transport.support', fromAddr: 'transport.support@protego.services',
        subject: 'EarlyIn Student Stayback List: Approved and Rejected Students',
        date: day(2 + i, 22), body: 'Early In/Stayback Rejection Notification' });
}

// --- 3. a coordinated, templated parent cluster (the 7 July shape) -------------------------
const TPL = 'Request for Timely Decision-Making During Heavy Rainfall';
[0, 8, 14, 21].forEach((offMin, i) => {
  const pasted = i >= 2;
  msg({ fromName: `Parents of ${CHILD[i]}`, fromAddr: `p.${slug(CHILD[i])}@fsksurat.in`,
        subject: pasted ? `Subject: ${TPL}` : TPL,
        date: day(7, 8, 27 + offMin),
        to: ['frontdesk@fsksurat.in', 'directors@fountainheadschools.org', 'founder@fountainheadschools.org',
             'ankita@fountainheadschools.org', 'transport@protego.services'],
        body: 'We request the school to decide on closure earlier when a red alert has been issued.' });
});

// --- 4. parent threads: some answered, some never ----------------------------------------
const PARENT_CASES: Array<[string, string, number | null]> = [
  ['Request for bonafide certificate', 'Kindly issue a bonafide certificate for my ward.', 2],
  ['Deleting leave application from nucleus', 'We request deletion of the leave entry applied earlier.', 5],
  ['Lost & found; 2 water bottles', 'My son has lost two water bottles at school.', 26],
  ['Correction Request for Attendance', 'Attendance for 8 July is marked wrongly.', null],
  ['Serious concern: child left unattended at the bus stop', 'Nobody was there to receive my child.', 1],
  ['Urgent: repeated harassment on the school bus', 'My child reports being bullied on the bus.', 3],
  ['HUGE SHOUTOUT TO THE BEST SCHOOL', 'Thank you to the whole team, we are grateful.', 40],
  ['Regarding Fees Hike', 'We would like clarity on the revised fee structure and a refund.', null],
  ['New Bus-stop request !!', 'Could a stop be added near our society?', 30],
  ['Half day permission', 'Kindly permit half day leave today.', 1],
  ['I am facing problem', 'Cannot log in to the portal since yesterday.', null],
  ['Request', 'Please let me know the procedure.', null],
  ['Concern Regarding the New Uniform Policy', 'We object to the revised uniform policy.', 8],
  ['Application for TC', 'We are relocating and need a transfer certificate.', 12],
];
PARENT_CASES.forEach(([subj, body, replyAfterH], i) => {
  const c = CHILD[i % CHILD.length];
  const d = day(9 + (i % 18), 6 + (i % 14), (i * 7) % 60);
  const to = i % 3 === 0
    ? ['frontdesk@fsksurat.in', 'founder@fountainheadschools.org', 'directors@fountainheadschools.org']
    : ['frontdesk@fsksurat.in'];
  const id = msg({ fromName: `Parents of ${c}`, fromAddr: `p.${slug(c)}@fsksurat.in`,
                   subject: subj, date: d, to, body, html: i % 4 === 0, qp: i % 8 === 0 });
  if (replyAfterH != null) {
    msg({ fromName: 'Front Desk', fromAddr: 'frontdesk.fsk@fsksurat.in', inReplyTo: id,
          subject: `Re: ${subj}`, date: new Date(+d + replyAfterH * 36e5),
          to: [`p.${slug(c)}@fsksurat.in`],
          body: 'Thank you for writing in. Mail forwarded to the Coordinator, TL and HRT.' });
  }
});

// --- 5. a student sender, and a Marathi circular ------------------------------------------
msg({ fromName: 'Echo Sample', fromAddr: 'a2026.echo.sample@fwgs.in',
      subject: 'character/Bonafide Certificate', date: day(12, 11),
      body: 'Requesting a character and bonafide certificate for college applications.' });
msg({ fromName: 'Shraddha S', fromAddr: 'shraddha.s@fwgs.in',
      subject: 'Important: Reference Videos for School Digital Platforms', date: day(13, 10),
      to: ['frontdesk@fwgs.in'],
      body: 'आपल्या पाल्याच्या शैक्षणिक प्रवासाची माहिती वेळोवेळी मिळावी आणि आपण त्यामध्ये सक्रिय सहभाग घ्यावा.' });

// --- 6. staff internal + an external vendor ----------------------------------------------
for (let i = 0; i < 20; i++) {
  msg({ fromName: 'Prapti D', fromAddr: 'prapti.d@fsksurat.in',
        subject: `ODAS Schedule for ${9 + i} August 2026`, date: day(9 + i, 14),
        body: 'The parent needs to report at frontdesk and collect the schedule for ODAS.' });
}
for (let i = 0; i < 12; i++) {
  msg({ fromName: 'A Vendor', fromAddr: 'sales@vendor.test',
        subject: 'Introducing our platform — book a demo', date: day(4 + i, 12),
        body: 'Our proposal for schools. Pricing and brochure attached. Book a demo.' });
}

writeFileSync(out, L.join('\n'), 'utf8');
console.log(`Wrote ${out} — ${count} messages.`);
