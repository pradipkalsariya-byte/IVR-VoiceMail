import { describe, it, expect } from 'vitest';
import { rulesClassifier, getClassifier, looksLikeSwitchboard , stripSignOff } from '../core/classify';

const go = (subject: string, body = '', extra: Record<string, unknown> = {}) =>
  rulesClassifier.classify({ subject, body, ...extra });

describe('every suggestion carries a reason (AI-15)', () => {
  const samples = ['Red alert', '', 'Missing bat', 'Proposal for our platform', 'Complaint'];
  for (const s of samples) {
    it(`"${s || '(blank)'}" gets a non-empty reason`, () => {
      const r = go(s, 'some body text');
      expect(r.reason.trim().length).toBeGreaterThan(10);
    });
  }
});

describe('vendor and job noise — the ~50% filtering win', () => {
  it('filters a vendor pitch', () => {
    const r = go('Transforming Assessments with Classwise AI', 'Introducing our platform for schools. Book a demo.');
    expect(r.category).toBe('not-a-request');
    expect(r.isVendorNoise).toBe(true);
  });

  it('filters a rankings-trophy chaser', () => {
    const r = go('India School Rankings Awards 2025-26', 'Claim your award trophy. Rankings survey attached.');
    expect(r.isVendorNoise).toBe(true);
  });

  it('routes a job application away from the desk', () => {
    const r = go('Application for HR Position', 'Please find my resume attached for the vacancy.');
    expect(r.category).toBe('not-a-request');
  });

  it('does NOT filter a known family who happens to use a trigger word', () => {
    const r = go('Proposal for a parent-teacher meeting', 'I would like to propose a meeting.', {
      senderIsKnownFamily: true,
    });
    expect(r.isVendorNoise).toBe(false);
  });
});

describe('safeguarding is content-based and fails toward a human (R3-18)', () => {
  it('catches a child left unattended and marks it critical', () => {
    const r = go('Serious Concern Regarding Child Being Left Unattended at Bus Stop', '');
    expect(r.category).toBe('child-safety');
    expect(r.isSafeguarding).toBe(true);
    expect(r.urgency).toBe('critical');
  });

  it('catches harassment on the bus', () => {
    const r = go('Urgent: Repeated Harassment on the School Bus', '');
    expect(r.isSafeguarding).toBe(true);
  });

  it('takes safeguarding priority over the transport rule', () => {
    // Every safety case in the real corpus was ALSO a bus case. Safety must win.
    const r = go('Bus left leaving student, careless of the driver', '');
    expect(r.category).toBe('child-safety');
  });
});

describe('the 14% that cannot be routed from a subject', () => {
  for (const s of ['', '(no subject)', 'School', 'Request', 'Complaint', 'Query']) {
    it(`"${s || '(blank)'}" is low confidence and says a person must read it`, () => {
      const r = go(s, '');
      expect(r.confidence).toBe('low');
      expect(r.reason).toMatch(/needs a person to read it/i);
    });
  }

  it('"Appointment" IS routable, and is not treated as unroutable', () => {
    // It looks as terse as the unroutable set, but it names an action. Confidence stays high.
    const r = go('Appointment', '');
    expect(r.category).toBe('meetings');
    expect(r.confidence).toBe('high');
  });

  it('separates two near-identical wordings with opposite meanings', () => {
    // Real pair from the corpus. No keyword rule gets both; the classifier must at least
    // not be confidently wrong.
    const a = go('I am facing problem', 'The parent portal will not let me log in.');
    const b = go('Why you change management', 'The school has moved away from its class size policy.');
    expect(a.category).toBe('systems');
    expect(b.category).toBe('school-direction');
  });

  it('falls back to low confidence rather than guessing high', () => {
    const r = go('Query', 'Something vague that matches nothing in particular.');
    expect(r.confidence).toBe('low');
  });
});

describe('body-only matches are flagged as lower confidence', () => {
  it('says so in the reason when the subject gave nothing', () => {
    const r = go('Hello', 'My son was left at the bus stop yesterday and nobody called.');
    expect(r.category).toBe('child-safety');
    expect(r.confidence).toBe('low');
    expect(r.reason).toMatch(/Subject gave no clue/);
  });
});

describe('the provider seam fails closed (AI-20)', () => {
  it('returns the rules provider by default', () => {
    expect(getClassifier().name).toBe('rules');
  });

  it('refuses an unapproved provider rather than falling back', () => {
    // Still the point of the seam. 'model' joined 'rules' when VK cleared the gate on
    // 26-Aug-2026; anything else must throw rather than silently degrade to rules, because a
    // typo in CLASSIFIER should stop the deploy, not quietly change how mail gets sorted.
    expect(() => getClassifier('some-cloud-model')).toThrow(/Available/);
  });

  it('offers the model provider now the gate is cleared', () => {
    expect(getClassifier('model').name).toBe('model');
  });
});

describe('switchboard detection — 48% of real logged calls', () => {
  const sb = (s: string) => looksLikeSwitchboard(s).yes;

  it('catches the real phrasings from the call log', () => {
    expect(sb('Mother wanted to speak to Devanshi ma’am')).toBe(true);
    expect(sb('Wants to talk to the class teacher')).toBe(true);
    expect(sb('Asked to connect to the coordinator')).toBe(true);
    expect(sb('Please ask her to call back')).toBe(true);
    expect(sb('Message for the HRT')).toBe(true);
    expect(sb('Wanted to reach the principal')).toBe(true);
  });

  it('does NOT flag a request with substance', () => {
    expect(sb('Bus 7 was late again and nobody messaged')).toBe(false);
    expect(sb('Requesting a bonafide certificate for my ward')).toBe(false);
    expect(sb('My child was left unattended at the bus stop')).toBe(false);
    expect(sb('Parcel sent')).toBe(false);
  });

  it('distinguishes a call back the CALLER wants from one WE promised', () => {
    // A promise we made while handling a real complaint must stay in the working queue.
    expect(sb('Bus was 40 minutes late. Promised to check with the operator and call back before 11.')).toBe(false);
    expect(sb('Told them we would call back once accounts confirm.')).toBe(false);
    expect(sb('We will call back after checking with the coordinator.')).toBe(false);
    // Whereas the caller asking for one is a message to pass on.
    expect(sb('Please ask the HRT to call back')).toBe(true);
    expect(sb('Mother wants a call back from the coordinator')).toBe(true);
  });

  it('always explains itself either way', () => {
    expect(looksLikeSwitchboard('wants to speak to the teacher').reason).toMatch(/message for someone else/);
    expect(looksLikeSwitchboard('the bus was late').reason).toMatch(/request with substance/);
  });

  it('never mistakes a safeguarding call for a message slip', () => {
    // "speak" appears, but the content is a safety report — the classifier must still see it.
    const text = 'Mother wants to speak to someone: her child was left unattended at the stop';
    expect(sb(text)).toBe(true); // it IS also a callback request
    expect(rulesClassifier.classify({ subject: text, body: '' }).isSafeguarding).toBe(true);
  });
});

describe('praise is recognised — 10% of real parent mail', () => {
  it('classifies a thank-you as praise, low urgency', () => {
    const r = go('HUGE SHOUTOUT TO THE BEST SCHOOL', '');
    expect(r.category).toBe('praise');
    expect(r.urgency).toBe('low');
  });

  it('classifies an achievement note as praise', () => {
    const r = go('Gratitude for selection to the Pickleball World Cup', '');
    expect(r.category).toBe('praise');
  });
});

// Feedback #13, 26-Aug-2026: "everything seems to be praise and achievement".
// Every case below is a real failure found by running the classifier over the 303 live emails
// and comparing old against new on the same corpus — not invented examples.
describe('the 26-Aug classifier round', () => {
  const go = (subject: string, body = '') =>
    rulesClassifier.classify({ subject, body, senderIsKnownFamily: true });

  it('does not call a sick-leave request praise because it ends "Thank you"', () => {
    // The exact shape that broke it: 20 of 20 live praise suggestions came from a sign-off.
    const r = go('Requesting for sick leave.',
      'Good morning maam,\nRidhan is suffering from fever. Please grant him leave today.\nThank you.\nRegards,\nMansi');
    expect(r.category).toBe('leave-medical');
  });

  it('does not call a COMPLAINT praise because it ends politely', () => {
    // "Re: Disappointed with FWGS" was being filed as praise on live data.
    const r = go('Disappointed with FWGS', 'This is the third time this has happened.\n\nThanks,\nParent');
    expect(r.category).not.toBe('praise');
  });

  it('still recognises genuine praise', () => {
    expect(go('Grateful for the support', 'We are grateful for everything.').category).toBe('praise');
    expect(go('Kudos to the team').category).toBe('praise');
  });

  it('CHILD SAFETY outranks everything, including an intent word in the subject', () => {
    // Regression: introducing the intent bonus let a praise subject outscore child-safety, and
    // the live corpus's only safeguarding item silently dropped to zero. Nothing outranks this.
    const r = go('Grateful, but my daughter was left unattended at the gate');
    expect(r.category).toBe('child-safety');
    expect(r.isSafeguarding).toBe(true);
    expect(r.urgency).toBe('critical');
  });

  it('lets the SUBJECT outrank the body', () => {
    // Old behaviour: a body match on an early rule beat a subject match on a later one.
    const r = go('Bonafide certificate needed', 'We will pick him up after collecting it.');
    expect(r.category).toBe('certificates');
    expect(r.confidence).toBe('high');
  });

  it('does not read a form field as the subject-matter — "Transport Route D-15"', () => {
    // 80 live emails matched transport on the word "route" alone, every one from a parent-card
    // form field. Boilerplate is not what the message is about.
    const r = go('Personal details update request for a student',
      'Emergency Contact No 9900000655\nTransport Route D-15 (Rudhnath Mandir)\nGrade 6');
    expect(r.category).not.toBe('transport');
  });

  it('does not read "(Grade 10)" in an exit-pass subject as an academic matter', () => {
    // Bare "grade" pushed academic from 4 to 86 of 303 in one change.
    const r = go('Student Exit Pass - New Form filled for Jetr Bhatia (Grade 10 - Apotheosis)', '');
    expect(r.category).not.toBe('academic');
  });

  it('keeps a real bus complaint in transport', () => {
    expect(go('Bus stop change for drop').category).toBe('transport');
    expect(go('Revised bus route details', 'Please advise the revised bus route.').category).toBe('transport');
  });

  it('reads "come with Subhash driver" as transport, not a systems problem', () => {
    expect(go('Pls allow Viyu to come with Subhash driver').category).toBe('transport');
  });

  it('says it is unsure rather than guessing, when only a sign-off matched', () => {
    const r = go('(no subject)', 'Thanks.\nRegards');
    expect(r.category).toBe('unclassified');
    expect(r.confidence).toBe('low');
    expect(r.reason).toMatch(/[Nn]eeds a person to read it/);
  });

  it('marks a body-only match as low confidence, never high', () => {
    const r = go('Quick question', 'Is the bus running tomorrow?');
    expect(r.category).toBe('transport');
    expect(r.confidence).toBe('low');
  });
});

describe('stripSignOff', () => {
  it('cuts a trailing courtesy block', () => {
    expect(stripSignOff('The bus was late again.\nThank you.\nRegards,\nMansi'))
      .not.toMatch(/Regards/);
  });

  it('keeps substance that FOLLOWS a mid-email thanks', () => {
    // Conservative by design: only a sign-off with little after it is cut.
    const kept = stripSignOff('Thanks for looking into this, but the bus is still late every day and we need it fixed this week.');
    expect(kept).toMatch(/bus is still late/);
  });

  it('leaves a body with no sign-off untouched', () => {
    expect(stripSignOff('Please issue a bonafide certificate.')).toBe('Please issue a bonafide certificate.');
  });
});
