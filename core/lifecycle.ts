// core/lifecycle.ts — which lifecycle actions a request's status admits. PURE.
//
// Exists because the record page offered a live reply box and a "Mark resolved" button on an
// UNFILED record (2026-08-09 UX review): nothing in the actions layer checked status, so both
// were fully callable — contradicting the queue's own promise that "only what you file enters
// the working queue". Filing is the acknowledgement act (QM-D12); a reply on an unfiled
// record would run the conversation ahead of the clock that measures it.
//
// The capability layer (core/permissions can()) answers WHO may act; this answers WHEN.
// Deliberately narrow: replying on a resolved record stays allowed (it reopens the
// conversation honestly via status 'waiting'), and reopen/file have their own paths.

export type LifecycleAction = 'reply' | 'resolve';

export function canActOnStatus(
  action: LifecycleAction,
  status: string,
): { allowed: true } | { allowed: false; reason: string } {
  if (status === 'unfiled') {
    return {
      allowed: false,
      reason:
        'File this request first — replies and resolution come after filing. Nothing enters the working queue unfiled.',
    };
  }
  if (status === 'not_a_request') {
    return {
      allowed: false,
      reason:
        'This is parked as not a request. If it turns out to be real, file it first — that brings it into the working queue.',
    };
  }
  return { allowed: true };
}
