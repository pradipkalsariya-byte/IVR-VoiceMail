// lib/notify-voicemail.ts — email a captured voicemail to the team its IVR menu routes to.
//
// Fire-and-forget by the SAME contract as lib/bridge-push.ts: the Request created in
// app/api/voicemail/route.ts is the record of truth, this is a convenience layered on top —
// a Gmail outage or an unconfigured send-as alias must never fail the webhook that already
// filed the record, so every failure path here returns a reason rather than throwing.

import 'server-only';
import { GmailMailSender, gmailConfigFromEnv } from './ingest/gmail';

export interface VoicemailNotifyResult {
  sent: boolean;
  detail: string;
}

export async function notifyVoicemailTeam(args: {
  to: string;
  subject: string;
  body: string;
  /** Unique to this voicemail — derives a stable MIME boundary (core/email-html.ts). Use the
   *  same sourceMessageId the Request itself was created with. */
  boundarySeed: string;
}): Promise<VoicemailNotifyResult> {
  const sendAsAlias = process.env.GMAIL_SEND_AS;
  const sender = new GmailMailSender({ ...gmailConfigFromEnv(), sendAsAlias });

  const gate = await sender.isReady();
  if (!gate.ready) return { sent: false, detail: gate.reason };

  try {
    await sender.sendNew({
      to: [args.to],
      subject: args.subject,
      body: args.body,
      fromAlias: sendAsAlias!,
      boundarySeed: args.boundarySeed,
    });
    return { sent: true, detail: `Emailed ${args.to}.` };
  } catch (err) {
    return { sent: false, detail: `Send failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
