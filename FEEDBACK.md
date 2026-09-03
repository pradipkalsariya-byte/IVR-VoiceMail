# Front Desk — feedback register, 26-Aug-2026 team session

Every piece of feedback from the 1-hour live walkthrough, mapped to the screen it was about.
**Nothing here is built yet.** This is the triage list — VK approves / rejects / parks each item,
and only approved items get implemented.

---

## Sources and how to read a citation

| | |
|---|---|
| Screen recording | `front desk meeting feebdack.mp4` — 59:27, 1912×1040, 30fps |
| Transcript | Plaud export, 00:00:03 → 01:02:52 |
| Summary | Plaud auto-summary (Hindi) |
| Frames | 1,784 stills at 1 per 2s, in the session scratchpad — **not committed** (see `.gitignore`) |

**Timeline offset — derived, not assumed.** The two recordings did not start together. At
transcript **00:03:05** Speaker 3 says the video mode has just started, after the first attempt was
lost ("रिकॉर्डिंग लॉस्ट हो गया... स्नैपिंग टूल"). That puts:

```
transcript 00:03:05  =  video 00:00:00        video_seconds = transcript_seconds − 185
frame file           =  t{ floor(video_seconds / 2) + 1 }.jpg
```

Corroborated three ways: 62:52 − 3:05 = 59:47 against a 59:27 runtime (the recording stopped
just before the transcript did); frame **t0127** (video 04:12) shows `/mailbox` with the ledger
open, matching transcript 07:18 where VK is describing the ledger; frame **t0271** (video 09:00)
shows the category dropdown open on FD-0514, matching transcript 12:23. The offset does not drift.

**A caveat on quotes.** The transcript is reliable for the English passages and **badly garbled for
the Hindi/Hinglish ones** — much of the Devanagari is phonetic nonsense. Where a quote below is
clean English it is near-verbatim. Where the source was garbled the quote is marked *(reconstructed)*
and I leaned on the auto-summary and the frame to establish intent. Items resting mostly on
reconstruction are listed again under **Ambiguous items** — I have not guessed at those.

---

## A · Email volume at source — "stop it before it arrives"

The single loudest theme. Roughly a third of the session was about mail that should never have
reached the desk at all.

> **MEASURED 27-Aug-2026 — see [`docs/SOURCE-REDUCTION-BRIEF.md`](docs/SOURCE-REDUCTION-BRIEF.md).**
> These items are all *outside the app*, so what this repo owes them is evidence, and there now
> is some.
>
> **Corrected 27-Aug:** an earlier note here said the working queue is 89% call slips.
> It is not — that was a DATABASE count, and #8 ("calls get their own room") is already built,
> so `belongsInQueue()` keeps every switchboard slip off the queue page. The queue page shows
> **61 items, all email**; the **419** call slips sit on `/switchboard`.
>
> What is still true: **412 of 413 call slips come from SEVEN missed-call report emails**, so #2
> stops ~477 records a month being manufactured for no reader. #1 is the biggest *email* saving
> (92 a month, 29% of all mail).

### 1 · Turn off the Student Exit Pass emails at source
- **Transcript** 00:54:12 · **video** 51:07 · **frame** `t1535` · **VK**
- *(reconstructed)* "Student exit pass... I've kept them in the inbox for now, haven't labelled
  them" — then 00:54:49, clean: **"Then why are you even getting an email for it? ... This should
  be kept, ideally only if there is something which is not on the app. Ideally this should only be
  for external emails coming, because external people don't have an app to refer to."**
- **Screen** `/mailbox` ledger — page is dominated by "Student Exit Pass - New Form filled for…"
  rows, all `Parked — automated` (visible in `t0127`).
- **Interpretation** Stop the exit-pass notification mail being sent to the desk address at all.
  The desk mailbox should ideally carry only mail from people who have no app to use.
- **Type** CHANGE (mostly outside the app — a Google Workspace / form-config change) · **Effort** S

### 2 · Turn off the Synapse missed-call report emails at source
- **Transcript** 01:00:57 · **video** 57:52 · **frame** `t1737` · **VK**
- *(reconstructed)* "पहले तो सोर्स बंद करो ना — सिनेप्स का ईमेल बंद करा, और वो एक्सेस पास बंद करा
  दो, तो ऐसे ही कम हो जाएगा."
- **Screen** `/` queue — the missed-call slips that make up most of it.
- **Interpretation** Stop the vendor's per-report emails rather than filtering them downstream.
- **Type** CHANGE (vendor/Workspace config) · **Effort** S

### 3 · One daily digest instead of per-call emails
- **Transcript** 00:57:36 · **video** 54:31 · **frame** `t1637` · **VK**
- *(reconstructed)* "…उसके एंड ऑफ द ईमेल रिपोर्ट आ जाए… एक रिपोर्ट, सिंगल रिपोर्ट चाहिए."
- **Interpretation** If the call data must arrive by mail at all, it should be one report at end
  of day, not a mail per report.
- **Type** CHANGE (vendor config) · **Effort** S

### 4 · Gmail rules to auto-label and auto-read the rest
- **Transcript** 00:56:02 · **video** 52:57 · **frame** `t1590` · **VK**
- *(reconstructed)* "लेबलिंग करना है और मूव कर देना है — वो तो दो मिनट का काम है"; and 00:57:01 on
  unread counts: mark them read so the unread count stays meaningful.
- **Interpretation** For whatever cannot be switched off at source, set Gmail filters that label
  and mark-as-read so they never present as unread work.
- **Type** CHANGE (Workspace config, not app code) · **Effort** S

### 5 · Internal staff mail should not create desk work
- **Status** ✅ RESOLVED + BUILT 27-Aug — VK: *"only when it carries no request; front desk decides."* `core/request-signal.ts` assumes a request unless there is positive evidence otherwise (a false "no request" hides real work; a false "carries a request" costs ten seconds of reading). The desk overrules it in one click via `bringIntoQueue()`, which returns the item untriaged with its clock counted from arrival.
- **Transcript** 00:55:42 · **video** 52:37 · **frame** `t1580` · **VK**
- *(reconstructed)* "इंटरनल ईमेल्स… फ्रंट डेस्क पे कोई फॉरवर्ड करे कि भी आपकी क्वेरी आई है… वो रीड
  हो जाएगा अपने आप."
- **Interpretation** A colleague forwarding something to the desk shouldn't behave like a parent
  request. Related to #29 (why `frontdesk.support@` receives traffic at all).
- **Type** QUESTION-TO-RESOLVE · **Effort** M

### 6 · Ignore mail older than one month
- **Transcript** 00:49:06 · **video** 45:61 · **frame** `t1381` · **VK**
- **"Six years of old email, we ignore it. I will ignore anything before one month, only for
  learning I will use. Yes, exactly. So otherwise there is no point in looking at anything which
  is older than that."**
- **Screen** `/` queue and `/mailbox` ledger, both showing 2020–2025 items.
- **Interpretation** Date-limit the working queue to the last month. Keep older mail for
  classifier training and search, but out of the queue.
- **Type** CHANGE · **Effort** S — this is the single cheapest fix on the list.

### 7 · Dates look like dummy data
- **Transcript** 00:14:57 · **video** 11:52 · **frame** `t0357` · **VK**
- *(reconstructed)* "ये डम्मी लगा है — 9 अगस्त है तो ये डम्मी है… मेरे को सबको डेट क्यों दिखा रहे हो?"
- **Interpretation** Old backfilled items read as fake data and undermine trust in the screen.
  Largely dissolves once #6 lands; noted separately because the *perception* was the complaint.
- **Type** CHANGE · **Effort** S · **Depends on** #6

---

## B · The queue and the missed-call pile

### 8 · Remove the phone-call stream from the queue entirely
- **Transcript** 00:44:03, restated as a decision at 00:49:49 · **video** 40:58 / 46:44 ·
  **frames** `t1230`, `t1403` · **VK**
- **"One thing that came to me is that we remove the whole phone calls stream from here"** and then,
  explicitly: **"Take away is clear that the call log needs to be removed, and what to do with the
  call log will be addressed separately."**
- **Screen** `/` queue — 395 of 440 unfiled items are switchboard slips.
- **Interpretation** Missed-call slips leave the working queue. Where they go instead is a
  **separate decision, deliberately deferred in the meeting.**
- **Type** CHANGE · **Effort** M · ⚠️ **Blocked on the follow-up decision** — see Q1.

### 9 · Missed-call records should name the parent, not just the number
- **Transcript** 00:34:53 · **video** 31:48 · **frame** `t0955` · **VK**
- *(reconstructed)* "मिस कॉल वाला… पेरेंट्स के नाम से आना चाहिए, फोन कॉल."
- **Screen** `/` queue — cards read "Missed call at 14:55 — 9900000216 · UNKNOWN SENDER".
- **Interpretation** Match the caller's number against `FamilyPhone` and show the family name.
  The data to do this already exists.
- **Type** CHANGE · **Effort** M

### 10 · Machine noise inside records
- **Transcript** 00:49:06 · **video** 45:61 · **frame** `t1381` · **VK**
- **"Few records contain machine noise, needs to be addressed."**
- **Interpretation** This is the raw-attachment-bytes-in-body defect. **Already half-fixed
  since the meeting:** 143 messages and 68 requests were cleaned on 26-Aug (50M characters
  removed) — but the *cause* is still live, so new mail with attachments recreates it.
- **Type** BUG · **Effort** S · **Status** cleanup done; extractor fix outstanding.

### 11 · Filters on every list
- **Transcript** 00:14:09 (Speaker 1), 00:14:23 (VK) · **video** 11:04 · **frame** `t0333`
- *(reconstructed)* Speaker 1: "आपके सारे इनमें फ़िल्टर्स नहीं हैं" — VK: "ऐड फ़िल्टर्स everywhere."
- **Interpretation** Every list surface needs filtering, not just the queue.
- **Type** NEW FEATURE · **Effort** M · **Overlaps** #22

### 12 · Post-resolution conversation clutters the queue
- **Transcript** 00:10:00 · **video** 06:55 · **frame** `t0208` · **VK**
- **"After conversation पूरा is cluttering this. ये बीच में बात भी थी कि ये सब मार्क्स हटाने हैं…
  I said it is still to do that."**
- **Interpretation** Replies arriving after a request is resolved should not push it back into
  the working view. VK notes this was already raised previously and is still outstanding.
- **Type** CHANGE · **Effort** M

---

## C · Classification

### 13 · The category guesses are wrong, often
- **Status** ✅ BUILT 26/27-Aug — hybrid: rules answer the 57% template mail (one shape, one answer), the model re-reads the 43% a person wrote. Fixed a live safeguarding miss found on the way (PRs #846, #847). Drafted replies (#13b) ship refusing safeguarding by taxonomy flag.
- **Transcript** 00:12:06 (Speaker 3), restated 00:33:01 and 00:49:06 (VK) · **video** 09:01 ·
  **frame** `t0271`
- Speaker 3: **"I think this AI is not doing that great. If it is saying this is thanks or child's
  achievement, then this is a problem."** VK at 00:49:06: **"Category guesses are weak. It's clear.
  It's what I said earlier. So we need to work on that."**
- **Screen** `/` queue and `/r/FD-0514` — a sick-leave request suggested as "Praise & achievement".
  Frame `t0271` shows the dropdown open with "Leave, medical & attendance" plainly available.
- **Interpretation** The classifier reads the subject line first and these subjects carry little
  signal. It should weight the body, and recognise the common request shapes.
- **Type** BUG · **Effort** L

### 14 · Bonafide requests are not counted as parent requests
- **Transcript** 00:07:18 → 00:08:12 · **video** 04:13 · **frame** `t0128` · **VK**
- **"Human, not a parent request. Reached as a job application."** — and the summary records it
  plainly: *"सिस्टम बोनाफाइड अनुरोधों को माता-पिता के अनुरोध के रूप में नहीं गिन रहा था."*
- **Screen** `/mailbox` ledger → the bonafide request row.
- **Type** BUG · **Effort** M

### 15 · Build the second level of the category list
- **Transcript** 00:46:45 · **video** 43:40 · **frame** `t1311` · **VK**
- *(reconstructed)* "कैटेगरी लिस्ट में वो फर्दर बनाई नहीं है, तो वो फर्दर बनाएंगे तो हो जाएगा."
- **Interpretation** The sub-category level was specified long ago and never built. **This is the
  estate's own P1 blocker** — categories cannot be retrofitted onto already-filed records.
- **Type** CHANGE · **Effort** L · ⚠️ needs the taxonomy decision first (already `[awaiting-you]`)

### 16 · Cluster counting looks wrong
- **Transcript** 00:32:55 · **video** 29:50 · **frame** `t0896` · **Speaker 3**
- **"Write something. Subject matter inside. But it is not even counting them right. It doesn't
  look like it is counting these ones right."**
- **Interpretation** This is the distinct-originator bug — a burst was counting messages rather
  than families. **Already fixed since the meeting** (12 clusters → 3, largest 231 → 15).
- **Type** BUG · **Effort** — · **Status** ✅ shipped 26-Aug, verify with the team.

### 17 · "New" can exceed "fetched" and nobody could explain it
- **Transcript** 00:06:19 → 00:07:18 · **video** 03:14 · **frame** `t0098` · VK + Speaker 4
- *(reconstructed)* VK: "मैं not so sure कि repeat हो रहा है… 83 से 81 जब हुए तो उसमें क्या हुआ…
  that explanation should be here."
- **Screen** `/mailbox` — the Recent passes table.
- **Interpretation** The page *does* carry an explanatory note, and it did not do its job: three
  people spent a minute confused. The columns need to explain themselves at the point of confusion.
- **Type** CHANGE · **Effort** S

---

## D · Assignment, ownership and cover

### 18 · Define the auto-assignment logic
- **Transcript** 00:24:31 (Speaker 1), 00:24:45 and 00:25:14 (VK) · **video** 21:26 · **frame** `t0644`
- Speaker 1 *(reconstructed)*: "उसका लॉजिक डिफाइन करना पड़ेगा." VK: *"give the logic… mostly handle
  this type of queries — कि ये उसके पास भेजो"*, with **"the option of changing it"**.
- **Interpretation** Route by category/specialisation, with a manual override always available.
- **Type** NEW FEATURE · **Effort** L · ⚠️ **Q2** — the routing table itself is VK's to define.

### 19 · Never assign outside someone's campus
- **Transcript** 00:26:32 · **video** 23:27 · **frame** `t0704` · **VK**
- *(reconstructed)* "राइट होना भी नहीं चाहिए… assign if I'm not in that campus… but you have super
  admin — so it should stop from assigning it."
- **Interpretation** Hard restriction: the assignee picker only offers people scoped to that
  request's campus. A super-admin may override.
- **Type** CHANGE · **Effort** M

### 20 · Reassign / escalate when the assignee is absent
- **Transcript** 00:44:34 → 00:45:52 · **video** 41:29 · **frame** `t1245` · **VK**
- **"I'm also wondering that if say Ayushi started the queue, she claimed it, and if she is missing
  on that day."** and **"And it needs to be replied… Ayushi should have replied to this, and either
  it gets automatically escalated."**
- **Interpretation** A claimed item whose owner is away must not sit. Escalation keyed on urgency
  and time-since-claim.
- **Type** NEW FEATURE · **Effort** L · ⚠️ **Q3** — what counts as "absent", and escalate to whom?

### 21 · Rotational roster for distributing work
- **Transcript** 00:53:02 (Speaker 4), 00:53:10 (Speaker 1), 00:53:23 (VK) · **video** 50:05 ·
  **frame** `t1504`
- Speaker 1 *(reconstructed)* describes an existing manual roster ("मैंने रोस्टर बनाया… मंडे से…
  दिवाली तक का रोस्टर"). VK: *"हर पंद्रह दिन में… ऑटोमेट हो जाएगा — always editable."*
- **Interpretation** Encode the roster the team already keeps by hand; automate the rotation but
  keep every cell editable.
- **Type** NEW FEATURE · **Effort** L

### 22 · One owner replies, not five people
- **Transcript** 00:18:54 · **video** 15:49 · **frame** `t0475` · **VK**
- **"The system names the habit, request one owner, and gives the request one owner. So basically
  the point is that instead of five people trying to figure out, one person should respond to it."**
- **Interpretation** Confirmation that the existing design is right — recorded as a **ratified
  behaviour, no change needed.**
- **Type** (no change) · confirms the recipient-sprawl panel on `/r/…`

---

## E · Replying, resolving and attachments

### 23 · Cannot attach a file — repeatedly hit
- **Transcript** 00:30:50, again at 00:41:24 · **video** 27:45 · **frame** `t0834` · VK + Speaker 4
- VK *(reconstructed)*: "दो पॉलिसीज़ अटैच… अगर मैं अटैच करना चाहूँ तो possible नहीं है." Speaker 4 at
  00:41:24: the parent's mail literally says *"please find attached"* and there is nothing to open.
- **Screen** `/r/…` reply area.
- **Interpretation** Two halves, and they are different jobs: **(a)** attach a file to an outgoing
  reply; **(b)** show the attachments that came *in* on the original mail. (b) is the one that
  bit twice in the session.
- **Type** NEW FEATURE · **Effort** L · ⚠️ **Q4** — which half first?

### 24 · Resolve without replying — turned out to be correct
- **Transcript** 00:30:28 (Speaker 1) → resolved at 00:43:31 (VK) · **video** 27:23 · **frame** `t0822`
- Speaker 1 flagged it: **"You can probably resolve it without replying to the family, because mark
  resolve is disabled until you reply."** VK later worked it through and **reversed**:
  **"Whether it should allow or not — ऐसा हो ही सकता है, क्योंकि मैंने फ़ोन पे कुछ क्वेरी क्लोज कर
  दी, तो I don't need to send a reply, I just need to file an internal comment… so it's valid,
  then there is no bug in that also."**
- **FINAL POSITION** ⚠️ **Reversal recorded.** Resolving with only an internal comment is
  legitimate and must stay possible. **No change** — but worth confirming the button state matches
  that, since the disabled control is what caused the confusion.
- **Type** QUESTION-TO-RESOLVE · **Effort** S

### 25 · Send replies from inside the system
- **Status** partly done — the app has sent email replies for some time (`canSendEmailReply`). What changed 27-Aug (PR #848) is that they are no longer a wall of `text/plain`: replies now leave as `multipart/alternative` with real paragraphs, bullets and emphasis. What is still missing is attachments on the way OUT (#23b).
- **Transcript** 00:44:34 · **video** 41:29 · **frame** `t1245` · **VK**
- **"replies read from the front desk, sending from inside the system rather than switching to
  Gmail"**
- **Type** NEW FEATURE · **Effort** L · already gated in the backlog ("Send mail as")

### 26 · Show turnaround time on resolution
- **Transcript** 00:29:07 · **video** 26:02 · **frame** `t0782` · **VK**
- **"So it will also track that we resolved it at what time… I'm hoping that when you resolve, it
  will show resolution in so much turnaround time."**
- **Type** NEW FEATURE · **Effort** M

### 27 · Waiting-time chip before breach
- **Transcript** 00:44:34 · **video** 41:29 · **frame** `t1245` · **VK**
- *(reconstructed)* "waiting time chip before a breach — so how long has the family been waiting"
- **Interpretation** Already specified as step 5 of the earlier round; the meeting re-raised it.
- **Type** NEW FEATURE · **Effort** M

---

## F · Workflow and UI

### 28 · Category-wise tabs, like the recruitment pipeline
- **Status** ✅ BUILT 27-Aug (PR #848) — categories are a tab strip, state and channel sit beneath as secondary filters, per VK's "category tabs, state as filters inside". Safeguarding leads the strip whatever its count.
- **Transcript** 00:50:43 (Speaker 1), 00:51:15 (VK) · **video** 47:38 · **frame** `t1430`
- Speaker 1 *(reconstructed)*: "एकदम सिंपलिफाई हो जाए — categories को टैब जैसे, recruitment भी…
  admission का dashboard देखेंगे तो उसके अंदर पूरा category-wise pages दी हैं… तो एकदम से एक
  क्लिक बटन है — देखो कि यहाँ अच्छे leads हैं, ये pending हैं, ये follow-up है. **So it's easy for
  them to understand what they have to look for and where.**" VK: **"Like the recruitment pipeline
  — the category view, but better, I mean UI."**
- **Interpretation** Replace/augment the single scrolling queue with a tabbed, category-filtered
  view modelled on the recruitment pipeline. **This is the concrete answer to #29's vague
  "not intuitive".**
- **Type** NEW FEATURE · **Effort** L · ⭐ **the biggest UX item in the session**

### 29 · "It still doesn't feel intuitive"
- **Transcript** 00:50:16 · **video** 47:11 · **frame** `t1417` · **VK**
- **"Somehow I still don't feel it is intuitive. That is something I am still not getting a strong
  hold on. It doesn't feel intuitive. But I don't know what to change either, and it's not clear."**
  Speaker 1 adds the look-and-feel is "going towards complication". VK clarifies at 00:50:35:
  **"Not UI friendly is okay. But more in terms of workflow, flow — how."**
- **Interpretation** Named explicitly as *workflow*, not visual design. #28 is the proposed remedy.
- **Type** CHANGE · **Effort** L · **superseded in practice by** #28

### 30 · Overall analytics is not doing anything
- **Transcript** 00:36:38 · **video** 33:33 · **frame** `t1007` · **VK**
- **"Overall analytics. I don't think anything is happening here. It's just to show what all are
  the different ways of analyzing this oversight."**
- **Interpretation** Reads as an observation rather than a request. Flagged for triage as possible
  EXPLICITLY-PARKED.
- **Type** QUESTION-TO-RESOLVE · **Effort** —

---

## G · New intake channels

### 31 · IVR "press 2 to leave a message" → transcribe → auto-create record
- **Transcript** 00:46:45 · **video** 43:40 · **frame** `t1311` · **VK**
- **"calls becoming record automatically — press 2 to leave [a message]. If in IVR we add an
  ability for them to add messages at the end… then that can automatically record, it gets
  transcribed and automatically becomes a record. So you don't have to call back to understand
  what they want. That will be the simplest way of handling this."**
- **Interpretation** The buildable-today alternative to call recording, which is blocked on vendor
  docs + legal. Directly addresses the missed-call pile.
- **Type** NEW FEATURE · **Effort** L · ⭐ VK called it "the simplest way"

### 32 · Standardise the LC / TC request path
- **Transcript** 00:17:53 → 00:18:45 · **video** 14:48 · **frame** `t0445` · VK + Speakers 1 & 4
- Speaker 4: **"They just email that we are going to come to school and collect certificate"** and
  *(reconstructed)* "सिस्टम ट्रिगर नहीं है, डायरेक्ट ईमेल." VK: **"Or do they also want to email
  us? Alumni."**
- **Interpretation** Leaving/transfer-certificate requests arrive as free-text email from students
  and alumni with no system path. Needs a real request type.
- **Type** NEW FEATURE · **Effort** L

### 33 · Anonymous tip line / student grievances
- **Transcript** 00:47:34 · **video** 44:29 · **frame** `t1335` · **VK**
- **"It has to do with student complaints. Students, if they want to complain anonymously, we can
  record or not record… it will also handle student grievances and all that. Student raising things
  themselves needs an age, and this has all been discussed."**
- **Interpretation** Re-raised, and VK himself notes the age-threshold dependency is unresolved.
- **Type** EXPLICITLY-PARKED (blocked on the student-login threshold + consent decisions)

---

## H · Access and identity

### 34 · User-management UI
- **Transcript** 00:44:34 · **video** 41:29 · **frame** `t1245` · **VK**
- **"So that right now a developer runs a script to give someone access — those users, adding them
  here, is still pending."**
- **Interpretation** Already the agreed shape (Ayushi, Prapti and Smita are deliberately waiting
  for this screen). The meeting confirms the priority.
- **Type** NEW FEATURE · **Effort** M · already `[ready] (P2)` in BACKLOG

### 35 · Parents see only "Front Office"; internal view names the person
- **Transcript** 01:02:04 · **video** 58:59 · **frame** `t1770` · **VK**
- **"The advantage of this is that on the front end, parents — it will only show Front Office. It
  will not show who sent it… but you will see it in their trains, you will see the name — exactly
  who replied."**
- **Interpretation** Ratifies existing design. **No change.**
- **Type** (no change)

---

## I · Process actions — not code

### 36 · WhatsApp replies carry the replier's initials
- **Transcript** 01:02:30 (Speaker 1) → 01:02:52 (VK) · beyond the video's end
- *(reconstructed)* "आप लोग WhatsApp की replies करते हो तो bracket में छोटा सा एक initial लिख दो,
  तो पता चल जाए."
- **Type** process instruction to the team · **Effort** —

### 37 · Richa, Rashida and Smita Henry to trial the system
- **Transcript** 01:00:57 · **video** 57:52 · **frame** `t1737` · **VK**
- **"Richa and Rashida also — tell Rashida, if you want, try it out and check, try it out. And we
  can add then also Smita Henry. Tell us what is wrong, so we discuss that."**
- **Note** Richa and Rashida already have accounts. **Smita Henry does not** — and per the standing
  decision she joins via the users screen (#34), not a script.
- **Type** process · **Effort** — · **couples to** #34

---

## J · Parked in the meeting

### 38 · Google Chat integration — explicitly parked
- **Transcript** 00:51:40 · **video** 48:35 · **frame** `t1459` · **VK**
- **"What it said was for connecting it to Google Chat accounts and creating those chats on the fly
  and then keeping track of that — will be a huge amount of work. So I think we need to do this,
  but we don't have the resources right now… So maybe we can talk about this later."**
- **Type** EXPLICITLY-PARKED

### 39 · Two people on the same item — parked by its own logic
- **Transcript** 00:44:34 · **video** 41:29 · **frame** `t1245` · **VK**
- **"Two people on the same item — it only matters when several people are working the queue at
  once, so that is going to happen."**
- **Type** EXPLICITLY-PARKED (deliberately last, same as the earlier round)

### 40 · Notifications — waits for the app
- **Transcript** 00:52:02 · **video** 48:57 · **frame** `t1470` · **VK**
- **"Once people go onto the app, then notifications will start coming. My work — as an interview
  comes in, this will come the same way."**
- **Type** EXPLICITLY-PARKED (depends on Nucleus 3.0)

---

## K · Already fixed since the meeting

Worth showing the team, because three things they raised are done.

| # | Item | Status |
|---|---|---|
| 16 | Cluster counting wrong ("231 families") | ✅ Fixed — 12 clusters → 3, largest 231 → 15 |
| 10 | Machine noise in records | ⚠️ Half — 143 messages cleaned, extractor cause still live |
| — | Garbled apostrophes in parent mail | ✅ Fixed — 74 requests repaired, decoder corrected |
| — | 4th desk address unmonitored | ✅ Fixed — `frontdesk.support@fsksurat.in` now in the filter |

Item 29 in the old round (**"four public addresses — I don't know which are the four"**, transcript
00:03:27, frame `t0012`) is answered by that last row: the four are `frontdesk@fsksurat.in`,
`frontdesk@fwgs.in`, `frontdesk@fountainheadschools.org` and `frontdesk.support@fsksurat.in`.
Speaker 4 explained the fourth at 00:48:54: **"if parents' front desk's email is not known, then if
they need support, they mail on support. They check emails and just forward them to the front
desk."** Worth surfacing the list in the UI so the question doesn't recur.

---

## TRIAGE — VK, 26-Aug-2026. These are decided.

| Q | Decision |
|---|---|
| **Q1 · Where do missed calls go** | **Their own stream/page** — filterable and searchable, out of the working queue. *And* start the IVR work in parallel (#31); a briefing note for the hardware conversation is at `docs/IVR-VOICEMAIL-BRIEF.md`. |
| **Q4 · Attachments** | **Both — incoming first.** Show what the parent attached (the half that bit twice), then attaching to outgoing replies alongside the send-from-system work. |
| **Q5 · Oversight analytics** | **A request, not an observation — make it useful.** Answer **both** questions on one page: system health up top (breaches, ageing, chase load, unowned), demand patterns below (category volumes and trends). Still never a per-person score. |
| **Q2 · Assignment routing** | **Roster sets who is on duty; category routing picks within that set.** Degrades sensibly to whoever is on when only one person is available. |
| **Q3 · Absence / escalation** | **Both — an explicit away flag reassigns immediately; an untouched-for-N-hours timer is the backstop,** with N scaled to urgency. The timer alone still works if nobody ever sets the flag. |
| **#28 · Tabbed view keying** | **Category tabs, with state as filters inside them.** |
| **Q7 · Scope** | **front-desk**, confirmed. Recruitment is the reference model for #28 only. |

### Build order — approved

Four batches, in this sequence. Each batch is its own commit (or commits), referencing item
numbers, so every change traces back to a transcript timestamp.

1. **Batch 1** — #6 date-limit to one month (dissolves #7) · #8 + #9 missed calls to their own
   stream, named by family · #10 the extractor fix · #13 classifier weighting.
2. **Batch 2** — #17 explain the fetched/new columns, plus anything cheap left over.
3. **Batch 3** — #11 filters · #19 campus-scoped assignment · #26 turnaround time · #34 users
   screen · #23a incoming attachments · #30 the rebuilt Oversight · #18 + #21 assignment and
   roster · #20 escalation.
4. **Batch 4** — #28 the category-tabbed view, with its own design pass.

Deferred to their own rounds, unchanged: #25 send-from-system and #23b outgoing attachments
(both gated on outbound mail), #32 LC/TC intake, #15 the second-level taxonomy (still needs the
locked-ruling decision), and everything in section J.

---

## Ambiguous items — I need answers, not guesses

**Q1 · Where do missed calls go?** ✅ ANSWERED — own stream, plus start IVR. #8 is unambiguous that they leave the queue, and VK said
explicitly that what happens to them next "will be addressed separately". Options: their own
stream/page; only surfaced once matched to a family; or dropped entirely once #31 (IVR voicemail)
exists. Which?

**Q2 · Routing table** ✅ SHAPE ANSWERED (roster-then-category); the actual category→person mapping is still owed. #18 needs the actual mapping — which category
goes to which person, per campus. That is yours to define; I can build the mechanism against a
placeholder table, but not invent the routing.

**Q3 · Absence** ✅ ANSWERED — flag plus timer. #20. Is absence a manually-set flag, a
calendar/leave integration, or simply "claimed and untouched for N hours"? And does it escalate to
a named backup, the campus lead, or back into the unowned pool?

**Q4 · Attachments** ✅ ANSWERED — both, incoming first. #23. Showing *incoming* attachments (which bit twice in
the session) or attaching to *outgoing* replies?

**Q5 · Oversight** ✅ ANSWERED — a request; build both halves. #30 reads to me as an observation
that the page is thin, not an ask to build more. Confirm park or build.

**Q6 · "The reply to a notification is still a request — I don't know what this means."**
Transcript 00:44:03, VK's own words about the FYI-stream design. This is the measured rule from the
archive analysis: filtering a notification family wholesale would silently drop genuine replies
(early-leave notices drew 306 replies from 398 messages). Does that answer it, or is a different
behaviour wanted?

**Q7 · Scope** ✅ CONFIRMED — front-desk. Your ASK said "a work order for the **recruitment** app". Everything in
this register is **front-desk**. Recruitment appears only as the *reference model* for #28's tabbed
pipeline view. Confirming I have that right.

---

## What I'd propose building first, if you want a recommendation

Not a decision — a suggestion for the triage conversation.

1. **#6** date-limit to one month — smallest change, biggest immediate calm, and it dissolves #7.
2. **#8 + #9** missed calls out of the queue and named by family — the pile was the loudest
   complaint, and #9 makes the slips useful wherever they end up. *(needs Q1)*
3. **#10** the extractor fix — cause still live, and it is contained.
4. **#13** classifier weighting — high value, and it is visible on every screen.
5. **#28** the tabbed category view — the real answer to "not intuitive", but it is an L and
   deserves its own design pass rather than being rushed in behind the others.
