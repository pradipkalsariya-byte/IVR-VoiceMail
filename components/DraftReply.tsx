'use client';

import { useState } from 'react';

// Feedback #13b — the drafted reply, shown where the desk is already standing.
//
// The framing is deliberate and is most of the design. A block of ready-looking prose sitting
// on a request page reads as "sent" unless it very plainly says otherwise, so it says otherwise
// twice: in the label above it and in the line beneath.
//
// It matters more here than it would elsewhere, because this page has a working reply box a
// few inches further down. The draft deliberately does NOT prefill it: a desk assistant
// should have to read the words before they become the words a parent receives.

export function DraftReply({ text, at }: { text: string; at: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a locked-down browser). The text
      // is selectable and right there, so this is a lost convenience, not a lost draft.
      setCopied(false);
    }
  };

  // Any «placeholder» left standing is a name we do not hold. Called out rather than blanked:
  // a desk assistant who sees «child» knows to fill it in, whereas a gap reads as finished.
  const gaps = [...new Set(text.match(/«[a-z-]+»/gi) ?? [])];

  return (
    <div className="flex flex-col gap-2">
      <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>

      {gaps.length > 0 && (
        <p className="text-xs text-warning">
          Fill in {gaps.join(', ')} before sending — we do not hold {gaps.length === 1 ? 'that name' : 'those names'}.
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={copy} className="fh-btn fh-btn--ghost text-xs">
          {copied ? 'Copied' : 'Copy the text'}
        </button>
        <span className="text-xs text-subtle">Drafted {at}. Nobody has sent it.</span>
      </div>
    </div>
  );
}
