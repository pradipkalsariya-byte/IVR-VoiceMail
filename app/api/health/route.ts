// Unauthenticated liveness probe (Railway). Stays outside the passcode gate — see middleware.ts.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, app: 'front-desk', ts: new Date().toISOString() });
}
