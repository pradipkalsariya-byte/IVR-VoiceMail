import type { Attachment } from '@/core/rfc822';
// lib/ingest/types.ts — the mail-ingestion seam.
//
// One interface, three implementations: a fake (tests), the seed (today's default, no network),
// and Gmail (code-complete, activation-gated). The orchestrator never knows which it has —
// the same pattern EGS used with DryRunActuator so the live connector could be written and
// tested long before anyone was allowed to point it at production.

/** One fetched message, already MIME-decoded. Source-agnostic. */
export interface IncomingMessage {
  /** RFC822 Message-ID. The idempotency key — polling must never duplicate. */
  messageId: string;
  /** Source thread id, so replies join an existing request instead of opening a new one. */
  threadId: string;
  from: { name: string; email: string };
  /** Everything in To + Cc — the recipient-sprawl evidence. */
  recipients: string[];
  subject: string;
  /** Best-effort plain text. */
  body: string;
  /**
   * The text/html part, when the message had one. Some senders put the CONTENT ONLY in the
   * HTML: the Enjay Synapse missed-call reports carry their call table as an HTML <table>
   * whose text/plain alternative is prose (validated against the archive, 2026-08-08), so
   * `body` cannot see a single row. Consumers that need STRUCTURE read this; everything else
   * keeps reading `body`.
   */
  bodyHtml?: string;
  /** What came attached — metadata only, never bytes (feedback #23). */
  attachments?: Attachment[];
  sentAt: Date;
  /** Which monitored address this arrived at, when the source can tell us. */
  deliveredTo?: string;
  /**
   * 'app' when this came through the in-app conversation rail (SD-COM-3) rather than a
   * mailbox — QM-D34 (2026-08-07). Default 'email'. The app rail arrives PRE-ROUTED:
   * `appCategory` carries the parent's pick from the deterministic menu, `campusOrgUnitId` the
   * campus from the signed-in student context, and per QM-D34(5) submission is filing.
   */
  channel?: 'email' | 'app';
  appCategory?: string;
  campusOrgUnitId?: string;
}

export interface FetchOptions {
  /** Only messages newer than this. The poller passes its last successful run. */
  since?: Date;
  /** Hard cap per run, so a first sync against a 109k archive cannot run away. */
  limit?: number;
}

export interface MailSource {
  readonly name: string;
  /** True when this source is actually usable (credentials present, gates cleared). */
  isReady(): Promise<{ ready: boolean; reason: string }>;
  fetch(opts?: FetchOptions): Promise<IncomingMessage[]>;
}

/** Outbound. Separate interface: reading is safe, sending is not. */
export interface MailSender {
  readonly name: string;
  isReady(): Promise<{ ready: boolean; reason: string }>;
  /**
   * Reply on an existing thread, as the front-desk address.
   *
   * `fromAlias` matters more than it looks: replies currently go out from individual staff
   * addresses, so the parent's next reply reaches one person and the rest of the desk never
   * sees the continuation. Sending as the desk is what closes that loop — and it needs
   * "Send mail as" authorised on the mailbox, which is why this is gated separately.
   */
  reply(args: {
    threadId: string;
    inReplyToMessageId: string;
    to: string[];
    /** Optional — omitted entirely from the MIME rather than sent as an empty header. */
    cc?: string[];
    subject: string;
    body: string;
    fromAlias: string;
  }): Promise<{ sentMessageId: string }>;

  /**
   * A brand-new message — no existing thread. First use: routing a captured IVR voicemail
   * (core/voicemail.ts) to the team mailbox its dialled IVR menu maps to.
   */
  sendNew(args: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    fromAlias: string;
    /** Unique to this message — derives a stable MIME boundary (core/email-html.ts). */
    boundarySeed: string;
  }): Promise<{ sentMessageId: string }>;
}
