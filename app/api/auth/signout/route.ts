import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie';
import { requestOrigin } from '@/lib/auth/google';

// POST /api/auth/signout — clear the session, back to the door. POST-only: a GET that
// mutates state is how a prefetcher signs somebody out.
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/signin', requestOrigin(req.headers)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
