import { db } from '@/lib/db';
import { currentActor } from '@/lib/session';
import { Card, Chip, NewBadge, Quiet, SectionTitle } from '@/components/bits';
import { formatInstantShortIST } from '@/core/dates';
import { canAdministerUsers, userAdminEmails, ROLE_PRESETS } from '@/core/user-admin';
import { UserAdmin } from '@/components/UserAdmin';

// Feedback #34 — "right now a developer runs a script to give someone access; those users,
// adding them here, is still pending."
//
// The screen is only half the rule: app/user-actions.ts re-checks the admin gate on every
// write, because a server action is a public endpoint and hiding a form protects nothing.

export const dynamic = 'force-dynamic';

export default async function Users() {
  const actor = await currentActor();
  const isAdmin = canAdministerUsers(actor.email);

  const [staff, campuses, recent] = await Promise.all([
    db.staff.findMany({
      orderBy: [{ name: 'asc' }],
      include: { campusGrants: { select: { campusOrgUnitId: true } } },
    }),
    // CAMPUSES only. Without the filter the group root (Fountainhead Education Trust)
    // appeared as a tickable campus beside the 'Every campus' box that means the same
    // thing -- two controls for one idea, and the one that looks specific is the one that
    // silently grants everything.
    db.orgUnit.findMany({ where: { type: 'CAMPUS' }, orderBy: { code: 'asc' } }),
    isAdmin
      ? db.accessChange.findMany({
          orderBy: { at: 'desc' }, take: 12, include: { actor: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const withAccess = staff.filter(s => s.permissions.length > 0);
  const withoutAccess = staff.filter(s => s.permissions.length === 0);

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Quiet>Access</Quiet>
          <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">Who has access</h1>
        </div>
        <Card stripe="normal" className="p-4">
          <p className="text-sm">
            You can see who has access, but not change it. Changes are limited to desk
            administrators — currently{' '}
            <strong>{userAdminEmails().join(', ')}</strong>.
          </p>
          <p className="mt-2 text-sm text-muted">
            That list is set outside the app, on purpose: it has to be a door that does not
            depend on any row in here, or the first grant could never be made.
          </p>
        </Card>
        <RosterList staff={withAccess} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Quiet>Access</Quiet>
        <h1 className="font-heading text-2xl font-bold tracking-tight mt-1">
          Who has access <NewBadge />
        </h1>
        <p className="mt-2 text-sm text-muted max-w-[72ch]">
          Signing in with a school account gets someone through the door. What they can do once
          inside is set here, per person, per campus. Nobody has access until they appear on
          this list — being on a school domain never implies a role.
        </p>
      </div>

      <UserAdmin
        campuses={campuses.map(c => ({ id: c.id, code: c.code, name: c.name }))}
        presets={ROLE_PRESETS}
        existing={staff.map(s => ({
          email: s.email, name: s.name, roleLabel: s.roleLabel,
          scopeOrgUnitId: s.scopeOrgUnitId,
          // 'group' collapses the null row back to the token the form uses. Authorisation reads
          // the grants; the form just needs to show what is already ticked.
          campusOrgUnitIds: s.campusGrants.map(g => g.campusOrgUnitId ?? 'group'),
          permissions: s.permissions,
        }))}
        actorEmail={actor.email ?? ''}
      />

      <RosterList staff={withAccess} />

      {withoutAccess.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle note="On file, but cannot do anything. Kept so the audit trail they appear in stays readable.">
            No access
          </SectionTitle>
          <Card stripe="normal" className="p-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {withoutAccess.map(s => (
                <span key={s.email}>{s.name} <span className="text-subtle">· {s.email}</span></span>
              ))}
            </div>
          </Card>
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle note="Every access change, newest first. Append-only.">
            What changed
          </SectionTitle>
          <Card stripe="normal" className="divide-y divide-border">
            {recent.map(c => (
              <div key={c.id} className="p-3 text-sm">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <Chip tone={c.kind === 'revoked' ? 'warn' : 'ink'}>{c.kind}</Chip>
                  <span className="font-medium">{c.subjectEmail}</span>
                  <Quiet>
                    {c.actor?.name ?? 'someone'} · {formatInstantShortIST(c.at)}
                  </Quiet>
                </div>
                <p className="mt-1 text-muted leading-snug">{c.detail}</p>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function RosterList({
  staff,
}: {
  staff: Array<{ email: string; name: string; roleLabel: string; scopeOrgUnitId: string; permissions: string[] }>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle note="Capabilities are the truth — the role label beside a name is a description, not a permission.">
        With access
      </SectionTitle>
      {staff.length === 0 && (
        <p className="text-subtle text-sm">Nobody has access yet.</p>
      )}
      {staff.map(s => (
        <Card key={s.email} stripe="normal" className="p-4">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-semibold">{s.name}</span>
              <Quiet>{s.email}</Quiet>
            </div>
            <Quiet>
              {s.roleLabel} · {s.scopeOrgUnitId === 'group' ? 'every campus' : s.scopeOrgUnitId.toUpperCase()}
            </Quiet>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.permissions.map(p => (
              <Chip key={p} tone={p === 'view_safeguarding' ? 'warn' : 'ink'}>{p}</Chip>
            ))}
          </div>
        </Card>
      ))}
    </section>
  );
}
