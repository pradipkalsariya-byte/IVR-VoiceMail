import { redirect } from 'next/navigation';
import { sessionIdentity } from '@/lib/auth/gate';
import { authMode } from '@/lib/auth/mode';

export const dynamic = 'force-dynamic';

// /unprovisioned — signed in on a school account, but nobody has given this person a role
// yet. Deliberately a calm explainer, not an error: being on the right domain never implies
// a role (estate rule), and the fix is a person provisioning them, not the user retrying.
export default async function UnprovisionedPage() {
  if (authMode() !== 'google') redirect('/');
  const session = await sessionIdentity();
  if (!session) redirect('/signin');
  if (session.sub) redirect('/');

  return (
    <main className="min-h-screen grid place-items-center bg-background px-6">
      <div className="fh-card w-full max-w-[460px] p-8">
        <h1 className="font-heading text-xl font-bold">Signed in — not yet set up</h1>
        <p className="mt-3 text-sm text-muted">
          You are signed in as <code className="font-mono text-xs">{session.email}</code>, which
          is a school account — but nobody has given it a Front Desk role yet, so there is
          nothing to show you.
        </p>
        <p className="mt-2 text-sm text-muted">
          Ask VK (or the front-desk lead) to provision your account; the moment that happens,
          signing in again lands you on the queue.
        </p>
        <form action="/api/auth/signout" method="post" className="mt-6">
          <button type="submit" className="fh-btn fh-btn--outline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
