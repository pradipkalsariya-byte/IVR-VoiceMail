// tools/mbox/parse.ts — streaming mbox reader.
//
// The only thing left here is the FILE I/O. All RFC822/MIME parsing moved to core/rfc822.ts,
// because live Gmail ingestion needs the same logic and core/ must stay importable by the app.
//
// Built for a Google Takeout / Vault export of a Google Group, which can run to several GB —
// so it streams line by line and yields one message at a time rather than loading the file.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { buildMessage, isSeparator, type ParsedMessage } from '../../core/rfc822';

export type RawMessage = ParsedMessage;

// Re-exported so existing callers and tests keep one import site.
export {
  buildMessage, isSeparator, parseAddresses, decodeHeaderValue, stripHtml, parseRfc822,
} from '../../core/rfc822';

/** Stream an mbox file, yielding one message at a time. */
export async function* readMbox(path: string): AsyncGenerator<RawMessage> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let buf: string[] = [];
  let started = false;

  for await (const line of rl) {
    if (isSeparator(line)) {
      if (started && buf.length) yield buildMessage(buf);
      buf = [];
      started = true;
      continue; // the separator itself is not part of the message
    }
    if (started) buf.push(line);
  }
  if (started && buf.length) yield buildMessage(buf);
}
