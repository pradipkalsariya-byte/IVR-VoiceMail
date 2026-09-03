// tools/gmail-authorize.ts — one-time consent flow that mints GMAIL_REFRESH_TOKEN.
//
// Run by a human, once, on a machine with a browser:
//
//   npx tsx tools/gmail-authorize.ts --account frontdesk-intake@example.org
//
// It reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from .env, opens Google's consent screen,
// catches the redirect on a loopback server, exchanges the code, and writes
// GMAIL_REFRESH_TOKEN back into .env. The token is never printed — the terminal shows only
// which account granted it and which scopes were approved.
//
// Why the account check exists: the person running this is almost never the mailbox. Consent
// granted by the wrong signed-in account yields a token for THEIR mail — a privacy incident
// that looks like success. With --account the script refuses to write on a mismatch.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Both scopes are required: fetch runs on readonly, replies run on send. Granular consent
// lets the user untick one box, so the grant is re-verified after the exchange.
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export function buildAuthUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const qs = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent together force a refresh_token even on a repeat run.
    access_type: 'offline',
    prompt: 'consent',
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (p.loginHint) qs.set('login_hint', p.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

/** Minimal .env line parser — enough for KEY=value with optional surrounding quotes. */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Replace KEY=… in place, or append it; comments and every other line survive untouched.
 * Line-wise so a CRLF file stays intact apart from the one line it owns.
 */
export function upsertEnvVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.replace(/\r$/, '').startsWith(`${key}=`));
  if (idx >= 0) {
    lines[idx] = line;
    return lines.join('\n');
  }
  const body = content.length && !content.endsWith('\n') ? `${content}\n` : content;
  return `${body}${line}\n`;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const expectedAccount = flag('account')?.toLowerCase();
  const envPath = flag('env') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

  // Mandatory, not optional: the whole reason this script exists is refusing a token granted
  // by the wrong signed-in account, and an optional check is a check that gets skipped.
  if (!expectedAccount) {
    console.error('Usage: npx tsx tools/gmail-authorize.ts --account <dedicated-mailbox-address>');
    console.error('The address is required so a token granted by the wrong signed-in account is refused, not saved.');
    process.exit(1);
  }

  if (!existsSync(envPath)) {
    console.error(`No .env at ${envPath} — copy .env.example to .env first, then add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.`);
    process.exit(1);
  }
  const env = parseEnv(readFileSync(envPath, 'utf8'));
  // Trimmed because a pasted trailing space reaches Google verbatim and comes back as an
  // unexplained invalid_client.
  const clientId = env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env before running this. Create them in the GCP console (OAuth client, type "Desktop app") and paste both lines in.');
    process.exit(1);
  }

  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());

  const server = createServer();
  await new Promise<void>(res => server.listen(0, '127.0.0.1', res));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback server failed to bind.');
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;

  const authUrl = buildAuthUrl({ clientId, redirectUri, state, codeChallenge: challenge, loginHint: expectedAccount });

  console.log('\nOpen this URL and sign in AS THE DEDICATED MAILBOX (not your own account):\n');
  console.log(`  ${authUrl}\n`);
  console.log('Approve BOTH permissions (read and send). Waiting for the redirect…');
  if (process.platform === 'win32') {
    // Best-effort convenience; the printed URL is the real path.
    const { exec } = await import('node:child_process');
    exec(`start "" "${authUrl.replace(/"/g, '')}"`);
  }

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out after 10 minutes — run the script again.')), 600_000);
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      if (url.pathname !== '/oauth2/callback') { res.writeHead(404).end(); return; }
      const err = url.searchParams.get('error');
      const finish = (msg: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(`<body style="font-family:sans-serif;padding:2rem"><h2>${msg}</h2><p>You can close this tab and return to the terminal.</p></body>`);
      };
      if (err) {
        finish('Authorization failed.');
        clearTimeout(timer);
        reject(new Error(err === 'access_denied'
          ? 'Consent was declined. Run again and approve both permissions.'
          : `Google returned "${err}". If it mentions admin policy, the Workspace admin must allowlist this OAuth client under Security → API controls → App access control.`));
        return;
      }
      if (url.searchParams.get('state') !== state) {
        finish('State mismatch — ignored.');
        return; // not our redirect; keep waiting
      }
      const c = url.searchParams.get('code');
      if (!c) { finish('No code in redirect.'); return; }
      finish('Authorized — the app has its token.');
      clearTimeout(timer);
      resolve(c);
    });
  }).finally(() => server.close());

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  const tok = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!tok.refresh_token) throw new Error('Google returned no refresh token. Run again (the script always requests prompt=consent, which should force one).');

  const granted = (tok.scope ?? '').split(' ');
  const missing = SCOPES.filter(s => !granted.includes(s));
  if (missing.length) {
    throw new Error(`Only part of the access was approved — missing: ${missing.join(', ')}. Run again and tick BOTH boxes; the token was not saved.`);
  }

  // Who actually granted this? Refuse to save a token for the wrong mailbox.
  const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  if (!profRes.ok) throw new Error(`Could not verify the authorized account (${profRes.status}); the token was not saved.`);
  const prof = (await profRes.json()) as { emailAddress?: string };
  const who = (prof.emailAddress ?? '').toLowerCase();
  if (expectedAccount && who !== expectedAccount) {
    throw new Error(`Signed in as ${who}, expected ${expectedAccount}. The token was NOT saved — run again in a browser window signed in as the mailbox (an incognito window is the easy way).`);
  }

  // Write-then-rename so an interruption cannot leave .env truncated — it holds DATABASE_URL
  // and everything else, not just this token.
  const next = upsertEnvVar(readFileSync(envPath, 'utf8'), 'GMAIL_REFRESH_TOKEN', tok.refresh_token);
  writeFileSync(`${envPath}.tmp`, next);
  renameSync(`${envPath}.tmp`, envPath);
  console.log(`\nDone. ${who} granted read + send; the refresh token is in ${envPath} (not shown here).`);
  console.log('Next: set MAIL_SOURCE=gmail in .env and restart the dev server — the queue\'s "Mail source" badge should read Live.');

  // The browser's keep-alive socket otherwise holds the event loop open ~5s after "Done".
  // Safe to destroy here: the token exchange and profile fetch above gave the tiny
  // callback response long since time to flush.
  server.closeAllConnections();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
