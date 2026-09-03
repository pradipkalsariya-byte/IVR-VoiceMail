// tools/mbox/redact.ts — moved to core/redact.ts on 2026-08-26.
//
// It moved because the model-backed classifier needs it too: nothing reaches an external API
// without passing through the same redaction the archive reports use. Keeping a second copy
// under tools/ would have meant two implementations of the one thing that must not drift —
// the same argument core/rfc822.ts makes about having a single MIME parser.
//
// Re-exported rather than updated everywhere so the analyser, the takeout tool and their tests
// keep importing what they always did.
export * from '../../core/redact';
