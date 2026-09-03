import { Card, Chip, ChannelChip, NewBadge, Quiet, SectionTitle } from '@/components/bits';

// The staff Help surface. Discharges the workspace rule that every prototype's Help page
// carries a running "What's new" list, kept in sync with the in-app NewBadge markers. No
// ruling id ever reaches the screen (2026-08-09 UX review) — where a behaviour traces to a
// locked ruling, the chip names its plain-language SUBJECT and the id lives in a comment
// beside the entry, for when staff hear the id in a review and need to find where it lands.

const DOORS = ['email', 'call', 'whatsapp', 'walkin', 'staff', 'event', 'app'] as const;

// The behaviours a desk person must know — each one exists because of a finding or a
// ruling, not a preference. Where a ruling is locked, its SUBJECT rides along as a plain
// chip — never the ruling id itself, which is desk-facing jargon (2026-08-09 UX review).
// The id stays traceable in the comment beside each entry instead.
const BEHAVIOURS: { line: string; why: string; subject?: string }[] = [
  {
    line: 'Nothing enters the working queue unfiled.',
    why: 'A person looks at every arrival first — about half of what reaches the public addresses is not a parent at all.',
  },
  {
    line: 'The assistant only suggests — with a reason.',
    why: 'It proposes a category and urgency and says why in plain language; a human files, replies and resolves, always.',
    subject: 'The assistant’s limits', // AI-13 · AI-15
  },
  {
    line: 'The response clock starts at desk-open, not arrival.',
    why: 'A quarter of parent mail lands before the desk is staffed — a 6 am email is not already late at 9 am.',
  },
  {
    line: 'Closing needs the family’s word.',
    why: 'A request closes with the family’s rating, or a coded reason why one could not be collected — never silently.',
    subject: 'Closure', // QM-D18
  },
  {
    line: 'A complaint about a staff member is closed to that person.',
    why: 'They cannot see it, own it or act on it anywhere in the system — not in the queue, not in search, not in counts.',
    subject: 'Complaints about staff', // QM-D33
  },
  {
    line: 'Safeguarding is named-access.',
    why: 'Safeguarding items open only for a named list of people, not a role — everyone else sees a masked entry.',
  },
];

// Entries age out when VK declares the feature final — the same event that clears its
// in-app NewBadge (grep NewBadge for the markers). Badge and entry move together: a badge
// added means an entry here; a badge cleared means its entry gets dropped.
const WHATS_NEW: { date: string; line: string; detail: string }[] = [
  {
    date: '2026-08-30',
    line: 'The queue rides alongside the open record.',
    detail:
      'Opening a request now keeps the live queue in a rail on the left (on a wide screen), so working through the pile is next-click instead of back-and-forth. Same links, same record pages — a row is only a link, and opening one files nothing. Safeguarding subjects stay masked in the rail exactly as they are on the queue.',
  },
  {
    date: '2026-08-24',
    line: 'Google sign-in — your own school account is the door.',
    detail:
      'The shared passcode retires: you sign in with your school Google account, and what you can do inside is set per person. During the pilot the Acting-as switcher stays available on top for trying other roles — the top bar always names who is really signed in. School-domain accounts that have not been set up yet land on a plain explainer instead of the queue.',
  },
  {
    date: '2026-08-24',
    line: 'The mail ledger — every processed email, and what became of it.',
    detail:
      'The Mailbox page now carries one row per mail the mailbox has processed, newest first: who sent it, what it said, and whether it became a request, joined its thread, was parked as vendor or automated traffic, or failed — with a live link to the request and, for the real mailbox, an Open-in-Gmail link back to the original. History from before the ledger existed has been carried in from the requests themselves.',
  },
  {
    date: '2026-08-24',
    line: 'The Mailbox page — pipe health, the pull button, and every pass on the record.',
    detail:
      'A new Mailbox room in the sidebar answers "is the desk mailbox actually being read?" in one sentence — with a five-minute timer reading it automatically once the live filter is set, a table of every pass (button or timer, who, what it did), and a one-line status strip at the top of the Queue linking here. Pulling twice can never duplicate: every message keys on its mail Message-ID.',
  },
  {
    date: '2026-08-24',
    line: 'Sender addresses and arrival provenance, everywhere mail shows.',
    detail:
      'Every list row and record now shows the raw from-address beside the sender — masked on safeguarding rows exactly like the name — needs-filing cards carry the arrival instant, a single-recipient email shows which desk address it arrived at, and timestamps follow the estate DD-MMM-YYYY form.',
  },
  {
    date: '2026-08-08',
    line: 'Parent app rail, chase ladder, claimable pool, and this Help page.',
    // The chase queue stays the front desk's own, never the family's, even though items
    // reference the family's own past-target wait (QM-D14) — the wording below says so
    // in plain language instead of naming the ruling.
    detail:
      'Parents can now submit and track requests from the app and rate on closure; items past their response target land on the desk’s own chases-owed strip on the Queue, reference-only — the front desk still owns the chase queue; unowned items can be claimed from My work.',
  },
  {
    date: '2026-08-08',
    line: 'My work stream, complaint-about-staff enforcement, Takeout intake kit.',
    detail:
      'Everyone sees their own items in four buckets on one page; a complaint about a staff member is invisible to that person end to end; historical mailbox exports can be loaded for analysis.',
  },
  {
    date: '2026-08-07',
    line: 'Two clocks, closure gate, cluster actions, safeguarding list masking, capability permissions.',
    detail:
      'First-look and reply clocks run separately; closing asks for the family’s rating; coordinated clusters can be actioned as one; safeguarding lists mask to named staff; what you can do follows capability, not job title.',
  },
  {
    date: '2026-08-06',
    line: 'Evidence analysis and team deck.',
    detail:
      '190 real conversations (redacted) analysed to ground every design choice, and the plan written up as a deck for the front-desk team.',
  },
  {
    date: '2026-08-05',
    line: 'First cut.',
    detail:
      'Queue, triage with a suggesting assistant, patterns, oversight and manual logging across six channels, on synthetic data.',
  },
];

export default function Help() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <Quiet>Front Desk · how it works</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">Help <NewBadge /></h1>
      </div>

      <section className="flex flex-col gap-4">
        <SectionTitle>What this is</SectionTitle>
        <p className="text-sm leading-relaxed max-w-[720px]">
          Every parent request, whichever door it came through, lands here as one record.
          There are seven doors — an email, a phone call, a WhatsApp message, a walk-in, a
          word to any staff member, a conversation at an event, or the parent app — and a
          family will use whichever is nearest. The desk never has to care which one it was.
        </p>
        <div className="flex gap-2 flex-wrap">
          {DOORS.map(d => <ChannelChip key={d} channel={d} />)}
        </div>
        <p className="text-sm leading-relaxed max-w-[720px]">
          Each record gets one owner and visible clocks: when it arrived, when someone first
          looked, when the family got a reply, when it closed. Nothing lives in one
          person&rsquo;s inbox, nothing waits unseen, and anyone covering the desk can pick
          up exactly where a colleague left off.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle note="The six behaviours a desk person must know.">
          How it behaves
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {BEHAVIOURS.map(b => (
            <Card key={b.line} stripe="normal" className="p-4">
              <div className="font-semibold text-sm">{b.line}</div>
              <p className="mt-1 text-sm text-muted leading-snug">{b.why}</p>
              {b.subject && <div className="mt-2"><Chip tone="ink">{b.subject}</Chip></div>}
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle note="Newest first. Entries retire when a feature is declared final.">
          What&rsquo;s new
        </SectionTitle>
        <Card stripe="normal" className="divide-y divide-border">
          {WHATS_NEW.map((e, i) => (
            <div key={`${e.date}-${i}`} className="p-4 flex flex-col gap-1">
              <div className="flex items-baseline gap-3 flex-wrap">
                <Quiet>{e.date}</Quiet>
                <span className="font-semibold text-sm">{e.line}</span>
              </div>
              <p className="text-sm text-muted leading-snug">{e.detail}</p>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
