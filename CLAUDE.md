# CLAUDE.md — front-desk prototype

Conventions for `front-desk`, the parent-request desk proof of concept. Extends the workspace
`../CLAUDE.md` and the global `~/.claude/CLAUDE.md`.

## What this is

A PoC for an **integrated parent request system** across six channels and four campuses,
built to be shown to the front desk team, campus leaders and the PRO. It exists to prove four
things that were genuinely unknown: that multi-channel capture is workable, that coordinated
contact can be detected, that classification is useful enough to save reading, and that
central oversight gives leaders what they actually want.

**Source of truth for behaviour:**
- The evidence: [`../docs/Front Desk Mail Analysis - 2026-08-05.html`](../docs/Front%20Desk%20Mail%20Analysis%20-%202026-08-05.html)
  (190 conversations / 419 messages, Jun 2023 – Aug 2026).
- The plan shown to the team: [`../docs/Front Desk Request System - Team Deck.html`](../docs/Front%20Desk%20Request%20System%20-%20Team%20Deck.html).
- The locked module spec it will graduate into:
  `C:\Dev\nucleus-erp-decisions\docs\specs\operations\Complaints Grievance and Incidents Conceptual Specification.md`
  (R3-18 + the 2026-07-14 staff-observed-incident extension).

## The parent-app bridge (30-Aug-2026)

**The Nucleus parent app (`../nucleus-parent/`) is the family's front door; this desk is the
school's face of the front-office slice of it** — QM-D34(2): a role/office thread ≡ a queue, and
the Front Office catch-all IS the front desk. The bridge keeps that one-record-two-faces rule
true across two applications:

- **Inbound**: `app/api/bridge/requests` files a parent-app thread here as a normal
  `channel: 'app'` request (same `appSubmission` pure function, submission-is-filing, FD ref
  returned); `app/api/bridge/requests/[ref]` takes the family's replies / rating / escalation.
  Pure validation + the category-vocabulary seam live in `core/bridge.ts` (tests:
  `tests/bridge.test.ts`).
- **Outbound**: `lib/bridge-push.ts` mirrors reply/resolve/reopen on app-channel requests to the
  parent app's webhook — fire-and-forget by contract (the desk must never fail because the
  parent app is down), and no staff name ever crosses the seam.
- **Dormant by default**: everything 404s/no-ops unless `PARENT_BRIDGE_SECRET` (+
  `PARENT_APP_WEBHOOK_URL` for pushes) is set. Production has neither — wiring prod is a
  separate, explicit decision. Local demo values live in `.env` (see `.env.example`).
- **`app/(family)` is frozen as the PoC face** (banner on `/family`): parent-surface work now
  happens in `nucleus-parent`, which files onto this same spine. Don't grow new parent UI here.

## Cardinal rules

1. **`core/` stays pure.** No I/O, no Prisma, no Next imports, deterministic. That purity is
   what lets it port into `C:\Dev\nucleus` unchanged. All classification, coordination
   detection and SLA arithmetic lives there with tests.
2. **Synthetic data only.** No real parent, child or staff record enters this repo. The seed's
   shape is faithful; its content is fabricated. If a demo needs realism, make the *shape*
   more faithful — never paste real correspondence.

   **This rule was breached once, on 2026-08-06, and caught only by a pre-commit sweep.** The
   redaction and sender-classification fixtures had been seeded with the *actual* strings from
   the live archive — four children's names, three staff names, a real student id, a real mobile
   number and a live shortened URL. The breach is easy to commit because *a redaction test
   naturally wants the real input it must mask.* Assume that pull every time you touch
   `tools/mbox/redact.ts` or its tests.

   Fixture identities are now the NATO set (`Alpha Sample`, `Bravo Sample`, …) and identifiers
   come from reserved ranges: **phones `9900000xxx`**, **student ids joining-year `2099`**.
   `tests/no-real-data.test.ts` enforces both mechanically and bans URL shorteners. Names cannot
   be detected mechanically — that half is still on you. **If you need a new fixture value, take
   it from the reserved ranges; do not widen the guard.**
3. **The assistant never acts.** It suggests a category and urgency with a mandatory
   plain-language reason. A human files, replies, resolves. No setting changes this (AI-13/15).
4. **`getClassifier()` fails closed.** Only `rules` is available until the AI-20 DPDP gate is
   cleared. Never add a fallback that silently sends correspondence to an unapproved provider.
5. **Actor comes from the server session.** Never from a form field. Scope is checked on reads
   *and* writes — knowing a reference is not permission to read it (R3-14).
6. **Safeguarding fails toward a human.** The detection regex is deliberately broad. A false
   positive costs thirty seconds; a false negative is a child. Do not "tighten" it for
   precision without a very good reason.

## Findings encoded as behaviour — do not "simplify" these away

| Behaviour | The finding behind it |
|---|---|
| Response clock starts at desk-open, not arrival | 26% of parent mail arrives 06:00–09:00 IST, before the desk is staffed |
| Nothing auto-enters the working queue | ~50% of public-address inbound is vendor solicitation; ~1 in 5 is a real request |
| Coordination detection, not just clustering | 7 July 2026: 4 identical subjects, 2 with a pasted `Subject:` line |
| Praise is a first-class category | 10% of real parent mail is thanks or a child's achievement, and it vanished |
| Selection fairness exists as a category | 5 real threads, no owner, and it does not belong to the desk |
| Safeguarding overrides transport in the classifier | Every real safety case was *also* a bus case |
| Founder-addressed mail must be ingestible | A co-founder was on 37 of 84 parent threads; both front desks on 12 |

## Stack

Next 15 (App Router) · React 19 · Prisma 6 · PostgreSQL · Tailwind 3.4 · Vitest.
Dev **4200**, Postgres **5446** (moved from 5444 on 2026-08-09 — roster-api's container took
5444; siblings hold 5434–5445).

**Design system: vendored, not depended on.** `styles/fountainhead/` carries the Fountainhead
DS (Beacon) CSS + Tailwind preset verbatim — see its README for the version and upgrade path.
The GitHub-tag dependency needs a PAT at install (the thing that had nucleus's CI red), so this
app takes the CSS in-repo instead: the full estate look (tokens, `.fh-*` components, dark
theme, print layer, the slot-Shell drawer via `app/_Shell.tsx`) with zero install-time
credentials. The 2026-08-08 build shipped a bespoke cream/serif look under a note here claiming
the house palette was "reproduced as Tailwind tokens" — it wasn't (no hue matched the brand
anchors), which is why this paragraph now names the mechanism instead of asserting the result.
App-side overrides go in `app/beacon.css`, never in the vendored files. Staff vocabulary for
stored enums lives in `core/labels.ts` — no status/kind/slug ever renders raw, and ruling IDs
(QM-D…) stay in code comments, never in user-facing copy.

## Commands

```bash
npm test          # the pure gate — 362 tests, no database
npm run typecheck
npm run db:up && npm run db:migrate && npm run seed
npm run dev
```

## Conventions

- Commit only when asked; end commit messages with the global `Co-Authored-By` line.
- Open/pending work goes in the workspace-root [`../BACKLOG.md`](../BACKLOG.md).
- Tests stay in the repo — if you wrote a harness to check something, commit it.
- When a finding changes the design, record *why* in a code comment the same turn. The
  comments in `core/` naming specific dates and percentages are load-bearing documentation,
  not clutter.
