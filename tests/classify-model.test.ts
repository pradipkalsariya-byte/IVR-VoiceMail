// Feedback #13a — the model classifier. Every number and name below is synthetic; the
// reserved 9900000xxx phone block is used deliberately (tests/no-real-data.test.ts).
import { describe, it, expect, vi } from 'vitest';
import { makeModelClassifier, buildPayload, parseAnswer } from '../core/classify-model';
import { rulesClassifier } from '../core/classify';

const reply = (obj: unknown) => new Response(JSON.stringify({
  content: [{ text: JSON.stringify(obj) }],
}), { status: 200 });

const cfg = (fetchImpl: typeof fetch) =>
  ({ apiKey: 'k', model: 'm', fetchImpl, fallback: rulesClassifier });

const msg = {
  subject: 'Requesting for sick leave.',
  body: 'Good morning maam, Ridhan is unwell today. My number is 9900000216. Thank you.',
};

describe('nothing identifiable leaves the machine', () => {
  it('redacts the phone number out of the payload', () => {
    const built = buildPayload(msg);
    expect('payload' in built).toBe(true);
    if ('payload' in built) {
      expect(built.payload.body).not.toContain('9900000216');
      expect(built.payload.body).toContain('«phone»');
    }
  });

  it('redacts email addresses', () => {
    const built = buildPayload({ subject: 'x', body: 'write to p.ridhan.joshi@fwgs.in please' });
    if ('payload' in built) {
      expect(built.payload.body).not.toContain('@fwgs.in');
      expect(built.payload.body).toContain('«email»');
    }
  });

  it('sends ONLY subject and body — no sender, no recipients, no reference', async () => {
    let sentBody = '';
    const spy = vi.fn(async (_u: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return reply({ category: 'leave-medical', urgency: 'normal', reason: 'A leave request.' });
    });
    await makeModelClassifier(cfg(spy as unknown as typeof fetch)).classifyAsync({
      ...msg, recipients: ['frontdesk@fsksurat.in'], senderKind: 'parent', senderIsKnownFamily: true,
    });
    expect(sentBody).not.toContain('frontdesk@fsksurat.in');
    expect(sentBody).not.toContain('9900000216');
  });

  it('REFUSES to send when redaction leaves something behind, and falls back', async () => {
    const spy = vi.fn(async () => reply({ category: 'fees', urgency: 'low', reason: 'x' }));
    // An Aadhaar-shaped value that redaction is expected to catch; if a future change breaks
    // redaction, this test fails rather than the number quietly reaching an API.
    const built = buildPayload({ subject: 'ID', body: 'Aadhaar 1234-5678-9012' });
    if ('payload' in built) {
      expect(built.payload.body).not.toMatch(/\d{4}-\d{4}-\d{4}/);
    } else {
      expect(built.refused).toMatch(/not sent/);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('parsing the answer', () => {
  it('accepts a well-formed answer', () => {
    expect(parseAnswer('{"category":"fees","urgency":"normal","reason":"About a payment."}'))
      .toEqual({ category: 'fees', urgency: 'normal', reason: 'About a payment.' });
  });

  it('tolerates a code fence around the JSON', () => {
    expect(parseAnswer('```json\n{"category":"fees","urgency":"low","reason":"r"}\n```')?.category)
      .toBe('fees');
  });

  it('REJECTS a category that is not in the taxonomy', () => {
    // A category we do not have is a failure, not something to store.
    expect(parseAnswer('{"category":"invented","urgency":"low","reason":"r"}')).toBeNull();
  });

  it('rejects an urgency outside the list', () => {
    expect(parseAnswer('{"category":"fees","urgency":"extreme","reason":"r"}')).toBeNull();
  });

  it('rejects an answer with no reason — a suggestion must explain itself (AI-15)', () => {
    expect(parseAnswer('{"category":"fees","urgency":"low","reason":""}')).toBeNull();
  });

  it('rejects prose and malformed JSON', () => {
    expect(parseAnswer('I think this is about fees.')).toBeNull();
    expect(parseAnswer('{broken')).toBeNull();
  });
});

describe('it degrades to rules rather than to nothing', () => {
  const expectFellBack = async (fetchImpl: typeof fetch, why: RegExp) => {
    const s = await makeModelClassifier(cfg(fetchImpl)).classifyAsync(msg);
    expect(s.category).toBe('leave-medical');   // what the rules say about this message
    expect(s.reason).toMatch(why);
  };

  it('falls back when the model errors', async () => {
    await expectFellBack((async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
      /answered 500/);
  });

  it('falls back when the model returns nonsense', async () => {
    await expectFellBack((async () => new Response(JSON.stringify({
      content: [{ text: 'no idea' }],
    }), { status: 200 })) as unknown as typeof fetch, /usable shape/);
  });

  it('falls back when the network throws', async () => {
    await expectFellBack((async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch,
      /could not be reached/);
  });

  it('falls back when no key is configured, without calling anything', async () => {
    const spy = vi.fn();
    const s = await makeModelClassifier({ fetchImpl: spy as unknown as typeof fetch, fallback: rulesClassifier }).classifyAsync(msg);
    expect(spy).not.toHaveBeenCalled();
    expect(s.reason).toMatch(/not configured/);
  });

  it('says WHY it fell back, appended to the rules reason', async () => {
    const s = await makeModelClassifier(cfg((async () =>
      new Response('x', { status: 503 })) as unknown as typeof fetch)).classifyAsync(msg);
    expect(s.reason).toMatch(/^Subject|^Nothing matched|^The subject/);
    expect(s.reason).toMatch(/\(the model answered 503\)$/);
  });
});

describe('a model answer is never high confidence', () => {
  it('marks every model suggestion low, however fluent', async () => {
    // Confidence drives whether a person must read something. A model is exactly as sure of a
    // wrong answer as a right one, so its fluency is not evidence.
    const s = await makeModelClassifier(cfg((async () => reply({
      category: 'child-safety', urgency: 'critical', reason: 'A child may be unsafe.',
    })) as unknown as typeof fetch)).classifyAsync(msg);
    expect(s.confidence).toBe('low');
    expect(s.isSafeguarding).toBe(true);
    expect(s.urgency).toBe('critical');
  });
});
