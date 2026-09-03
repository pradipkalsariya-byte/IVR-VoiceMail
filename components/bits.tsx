import { CHANNEL_LABEL, categoryDef, type Channel } from '@/core/taxonomy';
import { humanGap, slaState } from '@/core/sla';
import { readClocks } from '@/core/clocks';

// Design-system primitives for the staff face, on the Fountainhead DS (vendored — see
// styles/fountainhead/). The exported API (and the tone names pages pass in) is unchanged
// from the pre-Beacon version; only the rendering vocabulary moved to .fh-* components, so
// dark mode and density come from the tokens for free.

/** Old per-domain accent names → DS badge tones. Kept so call sites didn't have to change. */
const BADGE_TONE: Record<string, string> = {
  blue: 'fh-badge--primary',
  teal: 'fh-badge--info',
  amber: 'fh-badge--warning',
  green: 'fh-badge--success',
  rust: 'fh-badge--danger',
  deepred: 'fh-badge--danger',
  plum: 'fh-badge--accent',
  indigo: 'fh-badge--secondary',
  ink: '',
};

export function Chip({ children, tone = 'ink' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`fh-badge ${BADGE_TONE[tone] ?? ''}`}>{children}</span>;
}

export function Quiet({ children }: { children: React.ReactNode }) {
  return <span className="text-xs uppercase tracking-widest text-subtle">{children}</span>;
}

export function ChannelChip({ channel }: { channel: string }) {
  const tone: Record<string, string> = {
    email: 'blue', call: 'amber', whatsapp: 'green',
    walkin: 'plum', staff: 'indigo', event: 'rust', app: 'teal',
  };
  return <Chip tone={tone[channel] ?? 'ink'}>{CHANNEL_LABEL[channel as Channel] ?? channel}</Chip>;
}

export function CategoryChip({ category }: { category: string | null | undefined }) {
  const def = categoryDef(category);
  if (!def) return <Chip tone="ink">Untriaged</Chip>;
  return <Chip tone={def.accent}>{def.label}</Chip>;
}

export function SlaBadge({
  dueAt, firstReplyAt, now,
}: { dueAt: Date | null; firstReplyAt: Date | null; now: Date }) {
  const state = slaState({ dueAt, firstReplyAt, now });
  if (state === 'met') return <span className="fh-badge fh-badge--success">Replied</span>;
  if (!dueAt) return <span className="text-xs text-subtle">No clock yet</span>;
  if (state === 'breached') {
    return <span className="fh-badge fh-badge--danger">{humanGap(dueAt, now)} late</span>;
  }
  if (state === 'due-soon') {
    return <span className="fh-badge fh-badge--warning">due in {humanGap(now, dueAt)}</span>;
  }
  return <span className="text-xs text-muted">due in {humanGap(now, dueAt)}</span>;
}

export function Card({
  children, stripe = 'normal', className = '',
}: { children: React.ReactNode; stripe?: string; className?: string }) {
  // stripe-* severity edges live in globals.css, mapped to DS tokens.
  return <div className={`fh-card stripe-${stripe} ${className}`}>{children}</div>;
}

export function Stat({
  value, label, tone = 'blue',
}: { value: React.ReactNode; label: string; tone?: string }) {
  // Product-profile .fh-stat carries a tone-driven accent bar; danger/warning/success are the
  // DS's own modifiers, everything else stays the default (primary) accent.
  const MOD: Record<string, string> = {
    deepred: 'fh-stat--danger', rust: 'fh-stat--danger',
    amber: 'fh-stat--warning', green: 'fh-stat--success',
  };
  return (
    <div className={`fh-stat ${MOD[tone] ?? ''}`}>
      <div className="fh-stat__value">{value}</div>
      <div className="fh-stat__label">{label}</div>
    </div>
  );
}

export function SectionTitle({
  children, note,
}: { children: React.ReactNode; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <h2 className="font-heading text-xl font-bold tracking-tight">{children}</h2>
      {note && <span className="text-[13px] text-subtle">{note}</span>}
    </div>
  );
}

/**
 * "What's new" marker (global working rule): flags a recently added or changed user-facing
 * element until VK declares it final. Grep `NewBadge` to clear usages mechanically.
 */
export function NewBadge() {
  return <span className="fh-badge fh-badge--solid align-middle text-[10px]">New</span>;
}

/**
 * A raw email address on a list row or header (2026-08-24, the email-visibility round).
 * Its own component for two reasons: addresses must NEVER pass through `Quiet` (whose
 * `uppercase` transform would render P.DIYA.MEHTA@FWGS.IN — wrong as data, and unreadable),
 * and the null-in/nothing-out contract keeps every call site one expression. Pass it the
 * result of core/labels.ts#senderAddressLabel so safeguarding masking stays authoritative.
 */
export function AddressTag({ address }: { address: string | null }) {
  if (!address) return null;
  return <code className="font-mono text-xs text-subtle break-all">{address}</code>;
}

/** The acknowledgement clock, read-time-derived (QM-D15) — never a stored flag. Quiet when met:
 *  the badge exists to surface a family still waiting for a FIRST LOOK (QM-D12), not to award
 *  a medal for having looked. */
export function AckBadge({ req, now }: {
  req: {
    status: string; slaDueAt: Date | null; ackDueAt: Date | null;
    acknowledgedAt: Date | null; firstReplyAt: Date | null; resolvedAt: Date | null;
  };
  now: Date;
}) {
  const r = readClocks(req, now);
  if (r.ackState === 'na' || r.ackState === 'met') return null;
  if (r.ackState === 'overdue') {
    return <span className="fh-badge fh-badge--danger">unseen {humanGap(req.ackDueAt!, now)} past target</span>;
  }
  return <span className="fh-badge fh-badge--warning">awaiting first look</span>;
}
