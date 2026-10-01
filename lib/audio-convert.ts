// lib/audio-convert.ts — re-encode a vendor recording into a standard MP3 every browser plays.
//
// Why: the IVR vendor (way2voice.in) serves `audio/mp3` that is really 8 kHz MPEG-2.5 with a few
// hundred bytes of non-audio prefix. ffmpeg decodes it cleanly; browsers sit at 0:00. Found
// 01-Oct-2026 on a real recording (232 s, mean -25.8 dB — real speech, not silence).
//
// ffmpeg runs with FIXED arguments and no shell; the only untrusted input is the audio itself,
// piped on stdin. Never fatal: if ffmpeg is missing or rejects the input, the caller keeps the
// original bytes, so a conversion problem can never cost the recording.

import 'server-only';
import { spawn } from 'node:child_process';

const ARGS = [
  '-hide_banner', '-loglevel', 'error',
  '-i', 'pipe:0',
  '-ac', '1', '-ar', '16000', '-b:a', '32k',
  '-f', 'mp3', 'pipe:1',
];

export async function toStandardMp3(
  input: Buffer,
  timeoutMs = 30_000,
): Promise<{ ok: true; audio: Buffer<ArrayBuffer> } | { ok: false; reason: string }> {
  return new Promise(resolve => {
    let done = false;
    const finish = (r: { ok: true; audio: Buffer<ArrayBuffer> } | { ok: false; reason: string }) => {
      if (!done) { done = true; resolve(r); }
    };

    let proc;
    try {
      proc = spawn('ffmpeg', ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ ok: false, reason: `ffmpeg unavailable (${e instanceof Error ? e.message : String(e)})` });
      return;
    }

    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); finish({ ok: false, reason: 'ffmpeg timed out' }); }, timeoutMs);

    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => { if (err.length < 500) err += c.toString(); });
    proc.on('error', e => { clearTimeout(timer); finish({ ok: false, reason: `ffmpeg unavailable (${e.message})` }); });
    proc.on('close', code => {
      clearTimeout(timer);
      const audio = Buffer.from(new Uint8Array(Buffer.concat(out)));
      if (code === 0 && audio.length > 0) finish({ ok: true, audio });
      else finish({ ok: false, reason: `ffmpeg exited ${code}: ${err.trim().slice(0, 200) || 'no output'}` });
    });
    proc.stdin.on('error', () => { /* ffmpeg may close stdin early on bad input; 'close' reports it */ });
    proc.stdin.end(input);
  });
}
