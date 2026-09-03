// lib/bridge-push.ts — the outbound half of the parent-app bridge: when the desk acts on an
// app-channel request, mirror the act into the Nucleus parent app's thread (QM-D34: one
// record, two faces — this keeps the second face current).
//
// Fire-and-forget BY CONTRACT: this spine is the record; the push is a mirror. A desk reply
// must never fail, block, or even slow meaningfully because the parent app is down — so every
// failure path here is a console.warn, never a throw, and the timeout is short. The push only
// carries WHAT the office did, never WHO: no staff name crosses the seam (QM-D34(2) — the
// parent face renders "Front Office").
//
// Unconfigured (no PARENT_APP_WEBHOOK_URL / PARENT_BRIDGE_SECRET — production today) this is
// a no-op. Requests that never came over the bridge simply 404 on the far side; that is the
// contract, not an error worth logging loudly.

export type BridgePush =
  | { kind: 'message'; body: string }
  | { kind: 'resolved' }
  | { kind: 'reopened' };

export async function pushToParentApp(ref: string, event: BridgePush): Promise<void> {
  const url = process.env.PARENT_APP_WEBHOOK_URL;
  const secret = process.env.PARENT_BRIDGE_SECRET;
  if (!url || !secret) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': secret },
      body: JSON.stringify({ ref, ...event }),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.warn(`[bridge] push to parent app failed for ${ref}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
