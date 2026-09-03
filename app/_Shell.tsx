'use client';

import { useState, type ReactNode } from 'react';

// Responsive app shell — the estate's slot-Shell port (reference: cafeteria-checkin/app/_Shell.tsx).
// On desktop the sidebar is a fixed rail (DS default). On mobile (≤768px) it becomes an off-canvas
// drawer: the DS ships this behaviour but it's OPT-IN via `fh-appshell--drawer` + a `.fh-navtoggle`
// hamburger + a `.fh-appshell__scrim` + JS toggling `.is-nav-open`. Without it the full sidebar
// rendered in-flow and collided with the page content on phones (bit 7 apps, 2026-08-04).
// brand/nav/topbarRight are passed as slots so this client component doesn't have to import the
// server-resolved actor.
export function Shell({
  brand,
  nav,
  topbarRight,
  orgLabel = 'Fountainhead Schools · Front Desk',
  mainClassName = 'mx-auto w-full max-w-6xl px-6 py-8',
  children,
}: {
  brand: ReactNode;
  nav: ReactNode;
  topbarRight: ReactNode;
  orgLabel?: string;
  mainClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className={`fh-appshell fh-appshell--drawer${open ? ' is-nav-open' : ''}`}>
      {/* Clicking anywhere in the rail (all interactive children are nav links) closes the drawer. */}
      <aside className="fh-sidebar" onClick={close}>
        {brand}
        {nav}
      </aside>
      <div className="fh-appshell__scrim" onClick={close} aria-hidden />
      <div className="flex min-w-0 flex-col">
        <header className="fh-navbar">
          <button
            type="button"
            className="fh-navtoggle -ml-1 mr-1 rounded-md p-1.5 text-foreground hover:bg-surface-sunken"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="text-sm text-muted">{orgLabel}</span>
          <div className="ml-auto flex items-center gap-3">{topbarRight}</div>
        </header>
        <main className={mainClassName}>{children}</main>
      </div>
    </div>
  );
}
