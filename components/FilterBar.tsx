import Link from 'next/link';
import { CATEGORIES, CHANNELS, CHANNEL_LABEL, isSafeguardingCategory } from '@/core/taxonomy';
import { filtersToQuery, hasAnyFilter, type QueueFilters } from '@/core/queue-filters';

// Feedback #11 — filters, as LINKS rather than component state.
// Feedback #28 — and the categories are TABS, not a third row of pills.
//
// VK's triage was specific: "Category tabs, state as filters inside". The first version made
// state, category and channel three rows of identical pills, which says they are three equal
// choices. They are not — the desk thinks in WHAT IT IS ABOUT first ("who's got the transport
// ones?") and narrows within that. A tab strip says that; a row of pills does not.
//
// A filtered view being a URL means a desk person can send the screen instead of the
// instructions ("look at the transport ones"), it survives a refresh, and the back button
// behaves. It also keeps this component a server component: no client bundle for what is
// fundamentally a set of anchors.

const STATES: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'unfiled', label: 'Needs filing' },
  { key: 'working', label: 'Being worked' },
  { key: 'unowned', label: 'No owner' },
];

function Pill({
  href, active, children, count,
}: {
  href: string; active: boolean; children: React.ReactNode; count?: number;
}) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ' +
        (active
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-surface text-foreground hover:border-primary')
      }
    >
      {children}
      {typeof count === 'number' && (
        <span className={active ? 'text-white/80 tabular-nums' : 'text-subtle tabular-nums'}>
          {count}
        </span>
      )}
    </Link>
  );
}

/**
 * One tab in the strip.
 *
 * `alarming` pulls a safeguarding tab out of the ordinary run of categories. Everything else here
 * is sorted by volume, and on 27-Aug-2026 that would have put a single live child-safety item
 * near the tail of the strip behind whatever happened to be busiest that week. Volume is the
 * wrong sort order for the one category where the count is supposed to be low.
 */
function Tab({
  href, active, children, count, alarming,
}: {
  href: string; active: boolean; children: React.ReactNode; count?: number; alarming?: boolean;
}) {
  const base = 'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm '
    + 'transition-colors -mb-px';
  const state = active
    ? (alarming ? 'border-danger text-danger font-semibold' : 'border-primary text-foreground font-semibold')
    : 'border-transparent text-muted hover:text-foreground hover:border-border';
  return (
    <Link href={href} className={base + ' ' + state} aria-current={active ? 'page' : undefined}>
      {alarming && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />}
      {children}
      {typeof count === 'number' && (
        <span className={
          'tabular-nums text-xs ' + (active ? 'text-inherit' : 'text-subtle')
        }>{count}</span>
      )}
    </Link>
  );
}

export function FilterBar({
  basePath, filters, categoryCounts, total, shown,
}: {
  basePath: string;
  filters: QueueFilters;
  /** Per-category counts, already narrowed by the other active filters. */
  categoryCounts: Map<string, number>;
  total: number;
  shown: number;
}) {
  const link = (patch: Partial<QueueFilters>) =>
    `${basePath}${filtersToQuery({ ...filters, ...patch })}`;

  // Only categories that actually have something. An empty option is a dead end, and the
  // taxonomy has eighteen of them — showing all eighteen would bury the four that matter today.
  //
  // The ACTIVE category is always kept, even at zero. Dropping it left the screen filtered to
  // something with no pill lit and no way to tell what — an empty list and no explanation for
  // it, which is worse than an option that reads 0.
  const present = CATEGORIES
    .filter(c => (categoryCounts.get(c.key) ?? 0) > 0 || c.key === filters.category)
    // Safeguarding first, then by volume. A category whose count is SUPPOSED to be low must not
    // be sorted to the end by the fact that it is.
    .sort((a, b) => {
      const sa = isSafeguardingCategory(a.key) ? 1 : 0;
      const sb = isSafeguardingCategory(b.key) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return (categoryCounts.get(b.key) ?? 0) - (categoryCounts.get(a.key) ?? 0);
    });

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface/60">
      {/* The tab strip. Scrolls sideways on its own rather than wrapping to three lines on a
          phone — tabs that wrap stop reading as tabs, and the page body must never scroll
          horizontally. */}
      {present.length > 0 && (
        <div className="overflow-x-auto border-b border-border">
          <div className="flex items-stretch gap-1 px-2 min-w-max">
            <Tab href={link({ category: 'all' })} active={filters.category === 'all'} count={total}>
              Everything
            </Tab>
            {present.map(c => (
              <Tab
                key={c.key}
                href={link({ category: c.key })}
                active={filters.category === c.key}
                count={categoryCounts.get(c.key)}
                alarming={isSafeguardingCategory(c.key)}
              >
                {c.label}
              </Tab>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-subtle mr-1">Show</span>
        {STATES.map(s => (
          <Pill key={s.key} href={link({ state: s.key })} active={filters.state === s.key}>
            {s.label}
          </Pill>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-subtle mr-1">Via</span>
        <Pill href={link({ channel: 'all' })} active={filters.channel === 'all'}>Any door</Pill>
        {CHANNELS.map(ch => (
          <Pill key={ch} href={link({ channel: ch })} active={filters.channel === ch}>
            {CHANNEL_LABEL[ch]}
          </Pill>
        ))}
      </div>

      {hasAnyFilter(filters) && (
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="text-muted">
            {shown === 0 ? (
              <>Nothing here matches those filters.</>
            ) : (
              <>
                Showing <strong className="tabular-nums text-foreground">{shown}</strong> of{' '}
                <strong className="tabular-nums text-foreground">{total}</strong>
              </>
            )}
          </span>
          <Link href={basePath} className="text-primary underline hover:no-underline">
            Clear filters
          </Link>
        </div>
      )}
      </div>
    </div>
  );
}
