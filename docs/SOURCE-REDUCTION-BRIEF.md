# Stopping it before it arrives — what to switch off, and what it buys

**Measured against the live desk mailbox on 27-Aug-2026**, over the 26 days since 01-Aug.
Everything below is a count from production, not an estimate.

This is the evidence for register items **#1–#4** (and it bears directly on **#8**). Those items
are marked *CHANGE — outside the app*: they are Google Workspace, Google Form and vendor settings,
so nobody can ship them from this repo. What this repo can do is tell you exactly which ones are
worth the trouble.

> **No email addresses appear in this file.** This repository is synthetic-data-only and a test
> enforces it (`tests/no-real-data.test.ts`). Sender domains and volumes are safe to record;
> the individual addresses are in the app itself, on `/mailbox`, where they belong.

---

## Correction, 27-Aug-2026 — what the desk actually SEES

An earlier version of this brief opened with "the desk's queue is 89% call slips". **That was
wrong as the desk experiences it**, and the error is worth naming because it is the same one twice:
a count taken from the DATABASE, not from the screen.

The call slips carry `isSwitchboard`, and `belongsInQueue()` excludes those from the queue page
outright — register **#8**, "calls get their own room", is already built. Measured on production:

| where | items |
|---|---|
| The **queue page** | **61** — every one an email |
| …call slips on it | **0** |
| `/switchboard`, their own page | **419** |

So: the desk's working queue is *not* drowning in call slips. They are one click away on their own
screen, which is where VK asked them to be.

## What the missed-call report actually costs

The argument for **#2** survives the correction, but it is a different argument:

| | count |
|---|---|
| Call slips created since 01-Aug | 413 |
| …whose own trail cites a **missed-call report** | **412** |
| Missed-call report **emails** received in the same period | **7** |

**Seven emails a month manufacture roughly 477 records a month** that nobody works. One report
lists many calls and the app deliberately explodes it into one slip per call — correct behaviour
for a report somebody intends to work through, and pure accumulation when nobody does.

That is still worth switching off, at effort *S*. Just not because it is clogging the queue —
because it is a stream of records being created for no reader. And note the digest option in **#3**
does *not* fix it: the app explodes whatever arrives, so a digest of 60 calls still becomes 60
slips.

**Before acting on #2, one question worth asking the desk:** does anyone use the Switchboard
screen? If somebody works those slips, this is a live stream and switching it off loses something.
If nobody has opened it, 477 records a month are being created for no reader at all. The app can
answer that — the slips carry status and owner — but it is a question for the people, not the data.

## Email volume, by what sent it

323 emails a month at the current rate. **57% of them were written by a machine.**

| what it is | per month | share | register item |
|---|---|---|---|
| **Written by a person** | 137 | 43% | — this is the real work |
| Student Exit Pass notifications | **92** | 29% | **#1** |
| Sickbay visit notices | 23 | 7% | #1's sibling — same argument |
| Google Calendar invitations | 21 | 6% | **#4** |
| Vendor payment advice (bank) | 18 | 6% | **#4** |
| EarlyIn / LateOut approvals | 18 | 6% | #1's sibling |
| Missed-call reports | 8 | 3% | **#2** — see above |
| Google Workspace notices | 5 | 1% | **#4** |

**186 of the 323 could stop arriving.** The desk would be left with 137 emails a month, every one
of them written by a person who wanted something.

### By sending domain

| domain | emails |
|---|---|
| fountainheadschools.org | 112 |
| fsksurat.in | 104 |
| protego.services | 26 |
| fwgs.in | 20 |
| wockhardtschool.com | 9 |
| enjayworld.com | 7 |
| accounts.google.com | 2 |

Worth noticing: **the school is its own biggest sender.** 216 of 280 came from two internal
domains. Almost none of that is a parent.

---

## What to do, in the order the numbers argue for

### 1. Turn off the missed-call report email (#2, #3)
**Stops ~477 records a month being created for no reader** — on `/switchboard`, not in the queue. The report goes to a vendor address at `enjayworld.com`.
Two options, and the first is better:
- **Stop the per-report email entirely.** The call data is the vendor's to hold; the desk does not
  need a copy in its inbox.
- If it must arrive, **one end-of-day digest** rather than a mail per report (#3). Note this alone
  does *not* fix the queue — the app explodes whatever arrives, so a digest of 60 calls still
  becomes 60 slips. Switching it off is what fixes it.

VK in the session (00:57:36): *"एक रिपोर्ट, सिंगल रिपोर्ट चाहिए."*

### 2. Turn off the Student Exit Pass notification (#1)
**Removes ~92 emails a month, 29% of all mail.** This is a Google Form notification; the switch is
in the form's own response-notification settings, owned by whoever built the form.

VK (00:54:49): *"Then why are you even getting an email for it? … This should be kept, ideally only
if there is something which is not on the app. Ideally this should only be for external emails
coming, because external people don't have an app to refer to."*

The same argument applies unchanged to **sickbay notices (23/month)** and **EarlyIn/LateOut
approvals (18/month)** — all three are records of something already in an app, sent to a mailbox
whose job is people who have no app. Together: **133 a month.**

### 3. Gmail filters for what cannot be switched off (#4)
**Removes ~44 emails a month from view.** Calendar invitations, bank payment advice and Google
Workspace notices are not the desk's to stop — but they are the desk's to file. One filter each:
label, skip the inbox, mark as read, so the unread count means something again.

VK (00:56:02): *"लेबलिंग करना है और मूव कर देना है — वो तो दो मिनट का काम है."*

### 4. Still open: internal staff mail (#5)
Not actioned, deliberately. The register marks it **QUESTION-TO-RESOLVE**, and it is the one item
here where getting it wrong hides real work: a colleague forwarding a parent's complaint looks
exactly like a colleague forwarding a notification. The app already knows a `staff` sender when it
sees one (`core/senders.ts`), so this is ready to build the moment there is a rule to build.

**The question for VK:** should mail from a school domain skip the queue by default, or only when
it carries no request — and who decides which it is?

---

## What the app already does about this

None of the above is blocked on it, but for completeness:

- **Template mail never enters the working queue.** All 161 template emails are parked with no
  response clock (`core/machine-mail.ts` + `core/ingest.ts`).
- **They keep their real category**, so `/mailbox` still says what each record is — which is what
  makes "the desk can refer to the app" true rather than a slogan.
- **Nothing is deleted.** Parked means set aside and searchable, never removed.

So the desk is not drowning in the 186 machine emails, and — per the correction at the top — it is
not drowning in call slips either, because those never reach the queue page. What is true is
simpler and less dramatic: **323 emails a month arrive, 186 of them written by a machine, and 477
call records a month are manufactured from seven emails.** None of that is on fire. All of it is
avoidable at source, cheaply.
