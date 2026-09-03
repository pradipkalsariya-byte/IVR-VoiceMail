// lib/ingest/gmail.ts — the live Gmail adapter. CODE-COMPLETE, ACTIVATION-GATED.
//
// Reads the dedicated intake mailbox that sits as a member of the front-desk aliases. It is
// written and tested now so that the day the mailbox exists, going live is a config flip
// rather than a build — the same approach EGS took with its Google Directory connector.
//
// Two deliberate choices:
//
//  1. `format=raw` rather than Gmail's parsed payload tree, so all MIME/header/encoding logic
//     stays in the ONE tested implementation in core/rfc822.ts. A second parser is a second
//     set of bugs.
//  2. A hand-written thin REST client rather than `googleapis`. That package pulls a very large
//     dependency tree for four endpoints, and the supply-chain conversation on this project
//     concluded that lean beats convenient.
//
// Fails closed: without all four gates it refuses rather than silently returning nothing.

import { parseRfc822, parseAddresses } from '@/core/rfc822';
import type { FetchOptions, IncomingMessage, MailSender, MailSource } from './types';
import { buildNewMime, buildReplyMime } from '@/core/email-html';

/** Injectable so tests can drive the adapter with no network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  /** Must be "gmail" for this source to activate at all. */
  mailSource?: string;
  /** Restrict to the monitored aliases. Defaults to everything in the mailbox. */
  query?: string;
}

export function gmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GmailConfig {
  return {
    clientId: env.GMAIL_CLIENT_ID,
    clientSecret: env.GMAIL_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    mailSource: env.MAIL_SOURCE,
    query: env.GMAIL_QUERY,
  };
}

const b64urlToUtf8 = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/**
 * Gmail's per-user rate limit, and what it cost us.
 *
 * On 2026-08-25 the live mailbox stopped ingesting for FOURTEEN HOURS and the only outward sign
 * was `fetched=0` on every pass — indistinguishable from a quiet night. Gmail was answering 429
 * "User-rate limit exceeded. Retry after <t>" to EVERY call, including the cheapest profile
 * lookup, and the five-minute timer simply kept calling.
 *
 * The part that makes this a trap rather than a hiccup, measured directly against the live
 * account: EVERY REQUEST RESETS THE WINDOW TO NOW + 15 MINUTES, and a refused request counts.
 * Two probes 15 minutes apart each came back with a retry-after exactly 15 minutes past their
 * own timestamp. So a poll at any interval shorter than the window can never escape it — our
 * five-minute timer was not waiting out the penalty, it was renewing it, indefinitely. Nothing
 * short of silence gets out.
 *
 * Two rules follow, and both matter:
 *   1. When Gmail names a time, DO NOT CALL AGAIN BEFORE IT. Module-scope, so every source
 *      instance in the process shares one cooldown — a per-instance field would let a fresh
 *      instance on the next tick walk straight back into it.
 *   2. Space out the per-message reads. The limit is measured in quota units per second and a
 *      `messages.get` is 5 of them, so an unpaced burst of 200 sequential reads can cross it on
 *      a fast connection even though the daily total is trivial.
 */
let rateLimitedUntil = 0;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
/** ~14 reads/sec = ~70 quota units/sec, comfortably under the 250/sec ceiling. */
const READ_SPACING_MS = 70;

/** Exported for tests and for the health surface to explain itself. */
export function gmailCooldownUntil(): number { return rateLimitedUntil; }
export function resetGmailCooldown(): void { rateLimitedUntil = 0; }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class GmailMailSource implements MailSource {
  readonly name = 'gmail';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private cfg: GmailConfig, private http: FetchLike = fetch) {}

  /**
   * Four gates, all required. Mirrors the EGS activation posture: a missing credential must
   * produce a refusal with a reason, never a silent empty result that looks like "no new mail".
   */
  async isReady() {
    const missing: string[] = [];
    if (this.cfg.mailSource !== 'gmail') missing.push('MAIL_SOURCE=gmail');
    if (!this.cfg.clientId) missing.push('GMAIL_CLIENT_ID');
    if (!this.cfg.clientSecret) missing.push('GMAIL_CLIENT_SECRET');
    if (!this.cfg.refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
    return missing.length
      ? { ready: false, reason: `Gmail ingestion is not activated — missing: ${missing.join(', ')}.` }
      : { ready: true, reason: 'Gmail ingestion activated.' };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;

    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId!,
        client_secret: this.cfg.clientSecret!,
        refresh_token: this.cfg.refreshToken!,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) throw new Error(`Gmail token refresh failed (${res.status}). Re-consent may be required.`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('Gmail token refresh returned no access_token.');
    this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async api<T>(path: string): Promise<T> {
    if (Date.now() < rateLimitedUntil) {
      throw new Error(
        `Gmail is rate-limiting this account until ${new Date(rateLimitedUntil).toISOString()} — ` +
        'not calling again before then. Nothing is lost: the first pass after that time collects ' +
        'everything that arrived meanwhile.',
      );
    }

    const tok = await this.accessToken();
    const res = await this.http(`${API}${path}`, { headers: { authorization: `Bearer ${tok}` } });

    if (res.status === 429) {
      // Google puts the moment it will serve us again in the message body; the Retry-After
      // header is usually absent on this particular error. Honour whichever arrives.
      const body = await res.text().catch(() => '');
      const stamp = body.match(/Retry after (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1];
      const headerSecs = Number(res.headers?.get?.('retry-after'));
      const until = stamp && !isNaN(+new Date(stamp))
        ? +new Date(stamp)
        : Number.isFinite(headerSecs) && headerSecs > 0
          ? Date.now() + headerSecs * 1000
          : Date.now() + DEFAULT_COOLDOWN_MS;
      // A cushion past their clock: coming back the same second just earns another 429.
      rateLimitedUntil = Math.max(rateLimitedUntil, until + 30_000);
      throw new Error(
        `Gmail API ${path} failed (429 — user-rate limit). Holding off until ` +
        `${new Date(rateLimitedUntil).toISOString()}.`,
      );
    }

    if (!res.ok) throw new Error(`Gmail API ${path} failed (${res.status}).`);
    return (await res.json()) as T;
  }

  async fetch(opts: FetchOptions = {}): Promise<IncomingMessage[]> {
    const gate = await this.isReady();
    if (!gate.ready) throw new Error(gate.reason);

    const limit = opts.limit ?? 200;
    const terms: string[] = [];
    if (this.cfg.query) terms.push(this.cfg.query);
    if (opts.since) {
      // Gmail's `after:` has day granularity, so this over-fetches by up to a day. The
      // orchestrator dedupes on Message-ID, so over-fetching is safe; under-fetching is not.
      terms.push(`after:${Math.floor(+opts.since / 1000)}`);
    }
    const q = terms.join(' ');

    const ids: Array<{ id: string }> = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ maxResults: String(Math.min(500, limit)) });
      if (q) qs.set('q', q);
      if (pageToken) qs.set('pageToken', pageToken);
      const page = await this.api<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
        `/messages?${qs.toString()}`,
      );
      ids.push(...(page.messages ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < limit);

    const out: IncomingMessage[] = [];
    let read = 0;
    for (const { id } of ids.slice(0, limit)) {
      // Pace the reads. Sequential is not the same as slow: on a fast connection 200 back-to-back
      // `messages.get` calls (5 quota units each) can cross the 250-units-per-second user ceiling
      // and earn a multi-hour penalty, which is exactly what happened on 2026-08-25.
      if (read++ > 0) await sleep(READ_SPACING_MS);
      const full = await this.api<{ id: string; threadId: string; raw: string; internalDate?: string }>(
        `/messages/${id}?format=raw`,
      );
      const parsed = parseRfc822(b64urlToUtf8(full.raw));
      const h = parsed.headers;

      const dateHeader = h['date'] ? new Date(h['date']) : null;
      const sentAt = dateHeader && !isNaN(+dateHeader)
        ? dateHeader
        : new Date(Number(full.internalDate ?? Date.now()));

      out.push({
        // Prefer the RFC822 Message-ID: it is stable across mailboxes, whereas Gmail's own id
        // is per-account — and the same mail reaches several desk members.
        messageId: (h['message-id'] || `<gmail-${full.id}@local>`).trim(),
        threadId: full.threadId,
        attachments: parsed.attachments,
        from: parseAddresses(h['from'])[0] ?? { name: '', email: '' },
        recipients: [...parseAddresses(h['to']), ...parseAddresses(h['cc'])]
          .map(a => a.email).filter(Boolean),
        subject: (h['subject'] ?? '').trim(),
        body: parsed.text,
        // The missed-call reports' table exists only here (core/missed-calls.ts) — one MIME
        // implementation, so the live rail sees exactly what the archive analysis saw.
        bodyHtml: parsed.html || undefined,
        sentAt,
        deliveredTo: h['delivered-to'] || undefined,
      });
    }
    return out;
  }

  /**
   * Header-level metadata for every message in a thread — the provenance repair's read
   * (2026-08-24: the 12-Aug pull predated the senderEmail column, so the whole history
   * rendered "Sender not identified"; this heals it). format=metadata never downloads a
   * body, so re-reading the backlog costs headers only.
   */
  async threadHeaders(threadId: string): Promise<Array<{
    messageId: string;
    from: { name: string; email: string };
    recipients: string[];
  }>> {
    const gate = await this.isReady();
    if (!gate.ready) throw new Error(gate.reason);
    const t = await this.api<{
      messages?: Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }>;
    }>(
      `/threads/${encodeURIComponent(threadId)}?format=metadata`
      + '&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc',
    );
    return (t.messages ?? []).map(m => {
      const get = (name: string) =>
        m.payload?.headers?.find(x => x.name.toLowerCase() === name)?.value ?? '';
      return {
        messageId: get('message-id').trim(),
        from: parseAddresses(get('from'))[0] ?? { name: '', email: '' },
        recipients: [...parseAddresses(get('to')), ...parseAddresses(get('cc'))]
          .map(a => a.email).filter(Boolean),
      };
    });
  }
}

export class GmailMailSender implements MailSender {
  readonly name = 'gmail';

  constructor(
    private cfg: GmailConfig & { sendAsAlias?: string },
    private http: FetchLike = fetch,
    private source = new GmailMailSource(cfg, http),
  ) {}

  async isReady() {
    const base = await this.source.isReady();
    if (!base.ready) return base;
    if (!this.cfg.sendAsAlias) {
      return {
        ready: false,
        reason:
          'Sending is not activated — GMAIL_SEND_AS is unset. Replies must go out as the front-desk ' +
          'address, or the parent’s next reply reaches one person and the desk never sees it.',
      };
    }
    return { ready: true, reason: `Sending as ${this.cfg.sendAsAlias}.` };
  }

  async reply(args: Parameters<MailSender['reply']>[0]) {
    const gate = await this.isReady();
    if (!gate.ready) throw new Error(gate.reason);

    // The envelope is assembled in core/email-html.ts so it can be tested without a network.
    const mime = buildReplyMime({
      fromAlias: args.fromAlias,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      inReplyToMessageId: args.inReplyToMessageId,
      body: args.body,
    });

    const raw = Buffer.from(mime, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Deliberately uses the source's token plumbing rather than duplicating it.
    const tok = await (this.source as unknown as { accessToken(): Promise<string> }).accessToken();
    const res = await this.http(`${API}/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw, threadId: args.threadId }),
    });
    if (!res.ok) throw new Error(`Gmail send failed (${res.status}).`);
    const j = (await res.json()) as { id?: string };
    return { sentMessageId: j.id ? `<gmail-${j.id}@local>` : '<unknown@local>' };
  }

  async sendNew(args: Parameters<MailSender['sendNew']>[0]) {
    const gate = await this.isReady();
    if (!gate.ready) throw new Error(gate.reason);

    const mime = buildNewMime({
      fromAlias: args.fromAlias,
      to: args.to,
      cc: args.cc,
      subject: args.subject,
      boundarySeed: args.boundarySeed,
      body: args.body,
    });

    const raw = Buffer.from(mime, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const tok = await (this.source as unknown as { accessToken(): Promise<string> }).accessToken();
    const res = await this.http(`${API}/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new Error(`Gmail send failed (${res.status}).`);
    const j = (await res.json()) as { id?: string };
    return { sentMessageId: j.id ? `<gmail-${j.id}@local>` : '<unknown@local>' };
  }
}
