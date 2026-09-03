import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { SESSION_COOKIE, verifySession, type SessionPayload } from './cookie';
import { authMode } from './mode';

// lib/auth/gate.ts — where a request proves who it is (2026-08-24, the Google sign-in port).
// Three states, three destinations (the estate's shape): signed out → /signin; signed in on
// an allowed domain but not provisioned → /unprovisioned; provisioned → through. Legacy mode
// (no OAuth client configured) changes nothing anywhere — the gate is a no-op there.

/** The verified session, or null. Never throws; never redirects. */
export async function sessionIdentity(): Promise<SessionPayload | null> {
  if (authMode() !== 'google') return null;
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET!);
}

/**
 * The staff-face page gate, called at the top of the (staff) layout. In google mode a
 * request without a provable, provisioned identity never renders a page — it is sent to
 * sign in (or to the unprovisioned explainer). Returns the real signed-in Staff row in
 * google mode, null in legacy mode.
 */
export async function requireStaffPage() {
  if (authMode() !== 'google') return null;
  const session = await sessionIdentity();
  if (!session) redirect('/signin');
  if (!session.sub) redirect('/unprovisioned');
  const staff = await db.staff.findUnique({ where: { id: session.sub }, include: { scope: true } });
  // A session naming a Staff row that no longer exists is a deprovisioned colleague with a
  // still-live cookie — signed in, no longer provisioned. Exactly the /unprovisioned state.
  if (!staff) redirect('/unprovisioned');
  return staff;
}
