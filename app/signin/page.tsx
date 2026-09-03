import { redirect } from 'next/navigation';
import { sessionIdentity } from '@/lib/auth/gate';
import { authMode } from '@/lib/auth/mode';

export const dynamic = 'force-dynamic';

// /signin — the door (2026-08-24, the Google sign-in port). Lives OUTSIDE the (staff) route
// group: this is the one staff-face page a signed-out request may see. In legacy mode the
// page has no job and bounces home.

const ERROR_COPY: Record<string, string> = {
  denied: 'Google reported the sign-in was cancelled or refused. Try again.',
  state: 'The sign-in attempt did not match the one this browser started — usually an expired tab. Try again.',
  exchange: 'Google could not complete the sign-in just now. Try again in a moment.',
  unverified: 'That Google account’s address is not verified, so it cannot be used here.',
  domain: 'That account is not on a school domain. Sign in with your school Google account.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (authMode() !== 'google') redirect('/');
  const session = await sessionIdentity();
  if (session) redirect(session.sub ? '/' : '/unprovisioned');
  const { error } = await searchParams;

  return (
    <main className="min-h-screen grid place-items-center bg-background px-6">
      <div className="fh-card w-full max-w-[420px] p-8">
        <div className="flex items-center gap-2 font-heading text-lg font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm text-primary-foreground">FD</span>
          Front Desk
        </div>
        <p className="mt-3 text-sm text-muted">
          Sign in with your school Google account. Access is limited to Fountainhead staff
          accounts, and what you can do inside is set per person.
        </p>
        {error && (
          <p className="mt-4 rounded-md bg-danger-subtle border border-danger px-3 py-2 text-sm text-danger">
            {ERROR_COPY[error] ?? 'Sign-in failed. Try again.'}
          </p>
        )}
        <a href="/api/auth/google" className="fh-btn fh-btn--primary mt-6 w-full justify-center">
          Continue with Google
        </a>
      </div>
    </main>
  );
}
