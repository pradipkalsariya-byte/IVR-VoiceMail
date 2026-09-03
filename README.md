# Front Desk Request System — proof of concept

An integrated parent-request desk: **every request, whatever door it came through, in one place
with one owner.** Six channels (email · phone · WhatsApp · walk-in · via staff · at an event),
multi-campus from day one (FSK · FWGS · FSM · FALH), with coordination detection and an
assistant that sorts but never acts.

> **Synthetic data only.** No real parent, child or staff record is stored. Families are
> `Family 01`…`Family 34`; staff are role-named fictional accounts on `@fountainhead.test`.
> The seed's *shape* — channel mix, category mix, the 7 July cluster, the ~50% vendor noise —
> is faithful to the [2026-08-05 mail analysis](../docs/Front%20Desk%20Mail%20Analysis%20-%202026-08-05.html)
> so the numbers on screen match the numbers in the briefing deck.

## Run it

```bash
npm install
cp .env.example .env
npm run db:up          # Docker Postgres, host port 5444
npm run db:migrate
npm run seed
npm run dev            # http://localhost:4200
```

```bash
npm test               # 61 pure tests — no database needed
npm run typecheck
```

## The four screens

| Screen | What it proves |
|---|---|
| **Queue** (`/`) | Unfiled → working split, one owner, SLA clock, coordinated-cluster alert at the top |
| **Patterns** (`/patterns`) | The 7 July feature: near-identical messages arriving together shown as **one event**, with the evidence for why |
| **Oversight** (`/oversight`) | Per-campus open / unowned / late / resolved, category mix, channel mix, repeat families |
| **Log a request** (`/log`) | The 20-second capture for calls, walk-ins, WhatsApp, staff-relayed and events — with a live timer holding us to it |

## Why it is built this way

Three findings from the analysis drove design decisions that would otherwise look odd:

- **The clock starts at desk-open, not on arrival.** A quarter of real parent mail lands
  06:00–09:00 IST before the desk is staffed, and 13% between 21:00 and 06:00. Starting the
  clock on arrival would mark the desk late for messages nobody could have seen
  (`core/sla.ts`).
- **Nothing auto-enters the working queue.** About half of real inbound at the public address
  is vendor solicitation; roughly one in five is a genuine parent request. Everything is
  captured so nothing is lost, but only what a human files becomes work (`app/page.tsx`).
- **Coordination is detected, not just counted.** On 7 July 2026 four families sent an
  identical subject and two pasted a literal `Subject:` line — the signature of a circulated
  template. Thirteen contacts were one organised action; the school answered each separately
  (`core/coordination.ts`).

## Layout

```
core/        PURE TypeScript — no I/O, no Prisma, no Next imports. The portable part.
             taxonomy.ts · classify.ts · coordination.ts · sla.ts
tests/       61 tests over core/. The pure gate; needs no database.
prisma/      Schema + the evidence-shaped synthetic seed.
lib/         db client · session (acting-as, scope).
app/         Thin Next.js screens + server actions.
components/  UI pieces.
```

`core/` is deliberately free of framework and database imports so it ports into
`C:\Dev\nucleus` unchanged when this graduates — the same discipline that makes Nucleus's
engine portable.

## What is deliberately NOT built

Each sits behind a seam, stubbed rather than faked:

| Not built | Why, and what it needs |
|---|---|
| **Real Gmail ingestion** | Needs the dedicated mailbox added to the groups, plus OAuth. `MAIL_SOURCE=seed` today. |
| **Real outbound sending** | Needs *Send mail as* authorised on the front-desk address, or replies arrive from a strange sender and future replies stop threading. |
| **A model-backed classifier** | `CLASSIFIER=rules` is deterministic, offline, and safe on real mail. A model provider registers in `core/classify.ts` **only** once the AI-20 DPDP gate is cleared — in-region or justified transfer, a DPDP-grade DPA, no training on school data. `getClassifier()` throws on an unapproved provider rather than falling back. |
| **WhatsApp Business API** | Needs a business number, Meta verification and cost approval. WhatsApp requests are logged manually today, which is the honest sequencing given the desk already runs community groups. |

## Guardrails that are structural, not settings

- The assistant **suggests**; a human files, replies and resolves. There is no setting that
  changes this (AI-13).
- Every suggestion carries a plain-language **reason**, shown verbatim. If it cannot explain
  itself it does not appear (AI-15).
- Safeguarding is **content-based**, never flag-based, and fails *toward* a human: the
  classifier is deliberately broad, because a false positive costs thirty seconds of reading
  and a false negative is a child (R3-18).
- Every write derives its actor from the **server session**, never from a form field. The
  "Acting as" switcher sets a cookie so reads and writes stay coherent.
- Scope is checked on **reads and writes**. Knowing a reference is not permission to read it
  (R3-14 — the URL is never an access boundary).

## Ports

Dev server **4200**; Postgres **5444** (siblings hold 5434–5443).
