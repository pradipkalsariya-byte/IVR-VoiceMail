// A reply the desk types is now sent as multipart/alternative. This file guards the two things
// that can go wrong with that: the HTML being wrong, and the HTML being dangerous.
import { describe, it, expect } from 'vitest';
import { renderEmailHtml, renderEmailText, escapeHtml, buildReplyMime } from '../core/email-html';

describe('what a desk assistant types cannot become markup', () => {
  it('escapes angle brackets rather than emitting a tag', () => {
    const html = renderEmailHtml('Please email <script>alert(1)</script> if urgent.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`Tom & "Jerry" it's`)).toBe('Tom &amp; &quot;Jerry&quot; it&#39;s');
  });

  it('never emits an attribute the author controls, other than a vetted href', () => {
    // The parser's safeHref allowlist drops the scheme; the text survives, the link does not.
    const html = renderEmailHtml('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('keeps an ordinary link, with an escaped href', () => {
    const html = renderEmailHtml('[the form](https://example.test/a?b=1&c=2)');
    expect(html).toContain('href="https://example.test/a?b=1&amp;c=2"');
  });
});

describe('the formatting a parent actually sees', () => {
  it('turns blank-line-separated text into real paragraphs, not one wall', () => {
    const html = renderEmailHtml('First thing.\n\nSecond thing.');
    expect(html.match(/<p /g)?.length).toBe(2);
  });

  it('renders bold and italic', () => {
    const html = renderEmailHtml('This is **important** and this is *not*.');
    expect(html).toContain('<strong>important</strong>');
    expect(html).toContain('<em>not</em>');
  });

  it('renders a list as a list', () => {
    const html = renderEmailHtml('Bring:\n\n- a water bottle\n- a hat');
    expect(html).toContain('<ul');
    expect(html.match(/<li /g)?.length).toBe(2);
  });

  it('inlines every style, because Gmail strips style blocks', () => {
    const html = renderEmailHtml('Hello.\n\n- one');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('class=');
    expect(html).toContain('style="');
  });
});

describe('the plain-text part is rendered, not raw markdown', () => {
  it('does not show a parent the asterisks', () => {
    const text = renderEmailText('This is **important**.');
    expect(text).toBe('This is important.');
  });

  it('turns bullets into readable ones', () => {
    expect(renderEmailText('- a water bottle\n- a hat')).toBe('  · a water bottle\n  · a hat');
  });

  it('keeps a link readable by putting the url after the text', () => {
    expect(renderEmailText('[the form](https://example.test/f)'))
      .toBe('the form (https://example.test/f)');
  });

  it('keeps paragraphs apart', () => {
    expect(renderEmailText('One.\n\nTwo.')).toBe('One.\n\nTwo.');
  });
});

describe('the MIME envelope a parent\u2019s client actually parses', () => {
  const mime = () => buildReplyMime({
    fromAlias: 'frontdesk@fsksurat.in',
    to: ['parent@example.test'],
    subject: 'Packed lunch',
    inReplyToMessageId: '<abc123@mail.example.test>',
    body: 'Thank you for asking.\n\n- sandwiches are fine\n- no nuts',
  });

  it('is multipart/alternative, not text/plain', () => {
    expect(mime()).toContain('Content-Type: multipart/alternative; boundary="');
  });

  it('carries both a plain and an html part', () => {
    const m = mime();
    expect(m).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(m).toContain('Content-Type: text/html; charset=UTF-8');
  });

  it('puts PLAIN before HTML, which is what makes clients show the formatted one', () => {
    // RFC 2046: take the LAST part you understand. Reversed, every recipient silently gets the
    // plain version and the whole change does nothing — so this ordering IS the feature.
    const m = mime();
    expect(m.indexOf('text/plain')).toBeLessThan(m.indexOf('text/html'));
  });

  it('closes the multipart with a terminating boundary', () => {
    const m = mime();
    const boundary = m.match(/boundary="([^"]+)"/)![1];
    expect(m).toContain(`--${boundary}--`);
    // Opening boundary twice (one per part) plus the closing one.
    expect(m.split(`--${boundary}`).length - 1).toBe(3);
  });

  it('keeps the threading headers so the reply lands in the same conversation', () => {
    const m = mime();
    expect(m).toContain('In-Reply-To: <abc123@mail.example.test>');
    expect(m).toContain('References: <abc123@mail.example.test>');
  });

  it('does not double the Re: prefix', () => {
    const m = buildReplyMime({
      fromAlias: 'a@b.test', to: ['c@d.test'], subject: 'Re: Already a reply',
      inReplyToMessageId: '<x@y.test>', body: 'Noted.',
    });
    expect(m).toContain('Subject: Re: Already a reply');
    expect(m).not.toContain('Re: Re:');
  });

  it('is deterministic — the same reply twice produces the same bytes', () => {
    // The boundary is derived, not randomised, so a test can assert on the whole envelope.
    expect(mime()).toBe(mime());
  });

  it('never lets the boundary appear inside the body it delimits', () => {
    const m = mime();
    const boundary = m.match(/boundary="([^"]+)"/)![1];
    const body = m.slice(m.indexOf(boundary) + boundary.length);
    expect(body.split(boundary).length - 1).toBe(3);
  });
});
