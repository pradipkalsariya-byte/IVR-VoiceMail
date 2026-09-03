# IVR voicemail capture — briefing note for the telephony conversation

**For:** the hardware/telephony person, to sit with VK
**From:** Front Desk (Nucleus) · 26-Aug-2026
**One line:** we want callers who reach an unanswered line to be able to leave a message, and we
want that message to arrive as a written record — not as another missed-call alert.

---

## Why

The desk's switchboard currently produces a missed-call report for every unanswered call. Those
reports land as email and explode into individual callback slips — **426 slips from 147 distinct
callers**, measured on 27-Aug-2026. Every one says the same thing: *somebody rang, nobody knows
why, call them back to find out.*

Two facts worth carrying into the meeting, because they set the size of the prize:

- **Not one of those 426 has been opened.** They sit on their own screen, out of the working
  queue, and nobody has worked a single one since the oldest arrived on 12-Aug.
- **Not one caller shows as a name**, because the guardian phone numbers are not yet loaded for
  this campus. So today the list reads as 147 anonymous ten-digit numbers.

That is the honest baseline: the callback pile is not overwhelming the desk, it is simply inert.
A voicemail is what would make it worth opening.

That is a wasted round trip on both sides. The caller has already tried once; the desk has to ring
back blind. VK's framing in the 26-Aug review: *"so you don't have to call back to understand what
they want — that will be the simplest way of handling this."*

A voicemail turns "someone called" into "someone asked for X", which is a request the desk can
actually action, route and answer.

---

## What we are asking for

**1. Offer a voicemail option on unanswered calls.**
After the line has rung unanswered (or after the existing menu), play a short prompt — *"press 2 to
leave a message"* — and record what the caller says. Hold time short: 60–90 seconds is plenty for
"my daughter is unwell, she won't come today".

**2. Deliver each recording to us automatically.** In order of preference:

| | How it reaches us | Notes |
|---|---|---|
| Best | **Webhook / HTTP POST** to an endpoint we provide, with the audio file plus metadata | Immediate, no mailbox in the loop, easiest to make reliable |
| Good | **Audio file attached to an email** to a dedicated address | Works with what we already have; one message per call, not a digest |
| Workable | File dropped to **SFTP / a shared folder**, one per call | Fine if the naming carries the metadata below |

**3. Metadata we need with every recording** — this is the part that decides whether the feature is
useful or not:

- **Caller number** (CLI), unmodified — this is how we match the call to a family
- **Timestamp** of the call, with timezone
- **Which number they dialled** (we run several campus lines)
- **Duration**, and a **unique call ID** so a redelivery doesn't create a duplicate record
- **Audio format** — please tell us what we will get (WAV/mp3, sample rate, mono/stereo)

**4. Stop the per-call missed-call emails**, or reduce them to one end-of-day report. Separately
agreed on 26-Aug; mentioned here because it is the same vendor conversation.

---

## What we do with it

The recording is transcribed automatically and becomes a request in the system, with the audio
attached and the caller matched to the family by number. Nobody has to listen to it to know what it
was about, and nothing sits in a queue saying only "9900000216 rang".

Existing missed-call slips do not disappear — they move to their own stream, out of the working
queue. Voicemail is what replaces the callback guesswork.

---

# The technical half — transcription and getting it into the app

*Added 27-Aug-2026, at VK's request, for the hardware conversation. The section above is what the
VENDOR must provide. This section is what WE build, and it is here so the two halves can be agreed
in one sitting rather than two.*

**Status: built, 02/03-Sep-2026 — waiting on the vendor conversation for the field list, not on
us.** The endpoint below exists (`app/api/voicemail/route.ts`, dormant unless
`VOICEMAIL_WEBHOOK_TOKEN` is set — see `.env.example`), does the `callId` de-duplication
described here, matches callers by number, and attaches the audio to the record with a
staff-authenticated player on the request page.

**Transcription is wired to Google Cloud Speech-to-Text** (`core/transcribe.ts`'s `"google"`
provider, `TRANSCRIBER=google` + `GOOGLE_STT_API_KEY`) — ahead of the five-recording test below,
on VK's own explicit instruction (03-Sep-2026: "I have Google Cloud STT keys"), not because the
test was skipped. **Run that test anyway** against what this actually produces before trusting it
on real calls; the code path does not know whether it passed. `TRANSCRIBER=none` (default) keeps
the honest no-op — every voicemail then files `unclassified`, marked "needs a listen", with the
recording attached — never lost, never guessed at, either way.

**Each voicemail also emails the team its IVR menu selection maps to** — the YOCC/Enjay dashboard
screenshot VK shared already shows a `Menu` column per call ("Front Desk", "Transport"), and
`VOICEMAIL_MENU_TEAM_MAP` (`.env.example`) routes on exactly that label. **This is a NEW field the
vendor conversation still needs to confirm** (not in the original table below): does YOCC/Enjay's
webhook payload carry the selected menu at all, under what field name, and with what exact label
values? Until confirmed, the endpoint accepts an optional `menu` field and falls back to
`VOICEMAIL_FALLBACK_TEAM_EMAIL` (or sends nothing) when it is absent or unmapped — never a guess.

## Step 1 — the audio reaches us

**The endpoint we will expose:**

```
POST https://<front-desk-host>/api/voicemail
Content-Type: multipart/form-data
X-Voicemail-Token: <shared secret we issue>
```

| field | type | required | notes |
|---|---|---|---|
| `audio` | file | yes | whatever format the PBX produces — tell us which |
| `callId` | string | **yes** | the PBX's own unique id for the call |
| `callerNumber` | string | yes | CLI, unmodified. Empty/withheld is fine, say so explicitly |
| `dialledNumber` | string | yes | which campus line they rang |
| `startedAt` | string | yes | ISO 8601 **with timezone offset**, e.g. `2026-08-27T14:32:10+05:30` |
| `durationSeconds` | number | yes | |
| `menu` | string | no | which IVR menu option the caller selected before voicemail ("Front Desk", "Transport", …) — drives which team gets emailed. **New, unconfirmed**: added 03-Sep-2026 from the YOCC/Enjay dashboard's own `Menu` column; the vendor conversation still needs to confirm the field exists on the webhook payload, its name, and its exact label values |

**`callId` is the one field that must be right.** It is the de-duplication key: if the PBX retries
a failed delivery, we must be able to tell a retry from a second call. The app already does exactly
this for email using `Message-ID`, and a redelivery that creates a duplicate record is the single
most annoying failure mode in this whole pipe.

We reply `200` with the reference we created, or `200` with the same reference if we have seen that
`callId` before — so a retry is always safe. A `4xx` means do not retry; a `5xx` means please do.

**If a webhook is not possible**, the email fallback in the table above works and needs no new
endpoint: the app already parses attachments off incoming mail. It is slower and one more moving
part, so ask for the webhook first.

## Step 2 — transcription, and the thing that will actually decide this

**The language is the hard part, not the audio.** Parents in Surat will leave messages in Gujarati,
in Hindi, in English, and very often in a mix of all three inside one sentence. Any demo done in
clean English will look excellent and tell you nothing.

We have direct evidence of this from this project: the 26-Aug review recording was put through
transcription and the Hindi came back badly garbled — usable only because the video was there to
check it against. A voicemail has no video to check it against.

**So the one thing worth testing before committing to anything: record five real-sounding messages
— one Gujarati, one Hindi, one English, two mixed — and run them through whatever is proposed.**
Judge the option on those five, not on a vendor demo.

Three routes, in the order I would try them:

| | Route | Why / why not |
|---|---|---|
| **1** | **Google Cloud Speech-to-Text** (`gu-IN`, `hi-IN`, `en-IN`) | We are already a Google Workspace shop, so procurement and data-residency arguments are the ones already won. Supports Gujarati, which most engines do not. Needs a GCP project with billing. |
| **2** | **OpenAI Whisper API** | Strong on code-switched Indian speech, single API call, cheap. A separate vendor and a separate data-processing conversation — which for parent voicemail is a real DPDP question, not a formality. |
| **3** | **Vendor-side transcription**, if Enjay offer it | Fewest moving parts and worth ASKING about. Treat any claim about Gujarati with the five-recording test before believing it. |

**Whatever we choose, transcription failure must never lose the call.** If the audio cannot be
transcribed — wrong language, too noisy, silence — the record is still created, with the audio
attached and marked *needs a listen*. A pipeline that drops what it cannot understand is worse than
no pipeline, because the desk stops being able to trust it.

## Step 3 — what appears in the app

Once the transcript exists, this is all existing machinery:

1. **A request is created** on the call channel, with the transcript as its body and the audio
   attached to the record.
2. **The caller is matched to a family by number** — the same matcher the Switchboard uses. This is
   why loading the guardian phone numbers matters: without them the record says "9900000216 left a
   message", with them it says the family's name.
3. **It is classified like anything else** — suggested category, urgency and a plain-language
   reason, for a person to confirm. A voicemail saying "my daughter is unwell" lands in Leave,
   medical & attendance, not in a callback pile.
4. **It enters the working queue with a response clock**, because unlike a missed call it IS a
   request: somebody has said what they want.

That last point is the whole return on this work. A missed call is a question mark. A voicemail is
a request, and the app already knows what to do with requests.

## What to come back from the meeting with

- Can the IVR record a caller message at all — licence, module, or not at all?
- Webhook, email, or SFTP — which of the three can it do?
- What audio format, and does the CLI come through reliably?
- Can they transcribe, and if they claim Gujarati, will they run the five-recording test?
- What would a trial on ONE campus line take, and how long?

---

## Questions for the vendor

1. Does the current IVR support recording a caller message at all, or is that a licence/module we
   do not have today?
2. Which delivery methods above can it do? Webhook preferred; we can work with any of them.
3. Can the CLI (caller number) be passed through reliably, including for callers who withhold it —
   and what do we get when they do?
4. Is there a per-call or per-minute cost for recording and storage?
5. What is the retention on their side, and can we set it? We would rather hold the audio ourselves
   and have theirs expire quickly.
6. How long would this take to enable on a trial line, so we can test with one campus before rolling
   it out to all of them?
7. **New, 03-Sep-2026**: the YOCC/Enjay dashboard already shows a `Menu` column per call (Front
   Desk, Transport, …) — can the voicemail webhook carry that same selection as a field, and what
   are its exact label values? This is what lets a voicemail email the right team automatically
   instead of everything landing in one shared inbox.

---

## Two things to settle on our side, not the vendor's

- **Consent and the announcement.** A recorded message needs the caller told, at the start, that
  they are being recorded and why. This is *not* the same as the call-recording question that is
  already parked pending legal review: recording a voicemail a caller chose to leave is a much
  narrower thing than recording live conversations. It still needs the announcement, and it should
  be confirmed rather than assumed.
- **Retention.** How long we keep the audio once it has been transcribed and actioned. Shorter is
  better; the transcript is what the desk actually works from.

---

*Context: Front Desk feedback register, 26-Aug-2026 — item #31 (approved to start) and item #8
(missed calls leave the working queue). Related but separate: full call recording remains blocked
pending vendor documentation and legal sign-off.*
