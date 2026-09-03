import type { Attachment } from '@/core/rfc822';

// Feedback #23a: a parent wrote "please find attached" and the desk had nothing to open.
//
// We show WHAT arrived, not the file itself. The bytes are deliberately not stored — that is
// what produced the 3.7-million-character records — and Gmail still holds the original, which
// the Open-in-Gmail link at the top of the record reaches. Saying so plainly beats a download
// button that would sometimes fail.

const humanBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** A rough shape check — the column is Json, so what comes back is not typed by Prisma. */
function asAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is Attachment =>
      !!a && typeof a === 'object' &&
      typeof (a as Attachment).filename === 'string' &&
      typeof (a as Attachment).contentType === 'string',
  );
}

export function Attachments({ value }: { value: unknown }) {
  const items = asAttachments(value);
  if (items.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">
        {items.length === 1 ? 'Attached' : `${items.length} attached`}
      </span>
      <div className="flex flex-wrap gap-2">
        {items.map((a, i) => (
          <span
            key={`${a.filename}-${i}`}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
            title={`${a.contentType} · open the original in Gmail to read it`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span className="font-medium">{a.filename}</span>
            {typeof a.bytes === 'number' && a.bytes > 0 && (
              <span className="text-subtle">{humanBytes(a.bytes)}</span>
            )}
          </span>
        ))}
      </div>
      <span className="text-xs text-subtle">
        The file itself stays in Gmail — open the original above to read it.
      </span>
    </div>
  );
}
