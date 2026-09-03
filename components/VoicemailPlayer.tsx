// A captured IVR voicemail's recording (docs/IVR-VOICEMAIL-BRIEF.md). Deliberately separate
// from components/Attachments.tsx: that component's whole design is "the file stays in Gmail,
// here is what came attached" — a voicemail has no such second copy, so the honest thing is to
// let the desk actually play it, not point at a copy that does not exist.

const humanDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function VoicemailPlayer({
  requestId, callerNumber, durationSeconds,
}: {
  requestId: string;
  callerNumber: string;
  durationSeconds: number;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3 flex flex-col gap-2">
      <span className="text-xs font-medium text-muted">
        Voicemail from {callerNumber || 'a withheld number'} · {humanDuration(durationSeconds)}
      </span>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- there is no track to caption; the transcript above (when one exists) is the caption. */}
      <audio controls preload="none" className="w-full" src={`/api/voicemail/${requestId}/audio`}>
        Your browser cannot play this recording.
      </audio>
    </div>
  );
}
