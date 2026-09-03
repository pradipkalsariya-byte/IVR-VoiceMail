import Link from 'next/link';
import { currentActor, currentIdentity } from '@/lib/session';
import { staffDirectory } from '@/lib/staff';
import { requireStaffPage } from '@/lib/auth/gate';
import { personaSwitchEnabled } from '@/lib/auth/mode';
import { ActingAs } from '@/components/ActingAs';
import { Nav } from '../_Nav';
import { Shell } from '../_Shell';
import { ThemeToggle } from '../_ThemeToggle';

// The STAFF face of the system. The parent face lives in app/(family) with its own, much
// smaller chrome — QM-D34(1): one item, two faces, and a parent never sees queue mechanics,
// owner names or the staff nav. Route groups keep the two chromes apart without changing
// any staff URL. The Shell (client) handles the desktop rail vs the mobile off-canvas drawer;
// brand/nav/topbar are passed to it as slots.
//
// Since the Google sign-in port (2026-08-24) this layout is also the staff-face GATE: in
// google mode a request without a provable, provisioned identity is redirected before
// anything renders. Sign-in is WHO YOU ARE; the persona switcher (pilot-only,
// ENABLE_PERSONA_SWITCH) is WHAT YOU ARE ACTING AS, layered on top and labelled so — the
// topbar names the real person even mid-persona.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireStaffPage();
  const actor = await currentActor();
  const identity = await currentIdentity();
  const canSwitch = personaSwitchEnabled();
  const staff = canSwitch ? await staffDirectory() : [];

  const brand = (
    <div className="fh-sidebar__brand">
      <Link href="/" className="flex items-center gap-2 font-heading text-base font-bold">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground">FD</span>
        Front Desk
      </Link>
      <p className="mt-0.5 text-[11px] leading-tight text-muted">Prototype · synthetic data</p>
    </div>
  );

  return (
    <Shell
      brand={brand}
      nav={<Nav />}
      orgLabel="Fountainhead Schools · Front Desk"
      mainClassName="mx-auto w-full max-w-[1400px] px-6 py-8"
      topbarRight={
        <>
          {identity && (
            <span className="hidden md:inline text-xs text-subtle" title={`Signed in via Google as ${identity.staff.name}`}>
              Signed in: <strong className="font-medium text-muted">{identity.staff.name}</strong>
            </span>
          )}
          {canSwitch && (
            <ActingAs
              actorId={actor.id}
              staff={staff.map(s => ({ id: s.id, name: s.name, roleLabel: s.roleLabel }))}
            />
          )}
          {identity && (
            <form action="/api/auth/signout" method="post">
              <button type="submit" className="fh-btn fh-btn--ghost fh-btn--sm">Sign out</button>
            </form>
          )}
          <ThemeToggle />
        </>
      }
    >
      {children}
    </Shell>
  );
}
