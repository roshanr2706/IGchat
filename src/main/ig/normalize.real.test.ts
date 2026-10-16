import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeMessage, normalizeThread } from './normalize';

// Anonymized real responses produced by `node tools/make-fixtures.mjs` (git-ignored). Skipped when absent.
const dir = join(__dirname, '__fixtures__', 'real');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

const collect = (v: unknown, key: string, out: unknown[] = []): unknown[] => {
  if (Array.isArray(v)) v.forEach((x) => collect(x, key, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === key) out.push(x);
      collect(x, key, out);
    }
  }
  return out;
};

describe.skipIf(files.length === 0)('normalize against anonymized real captures', () => {
  it('normalizes every captured thread and message without throwing', () => {
    let threads = 0;
    let messages = 0;
    for (const f of files) {
      const json: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const t of collect(json, 'as_ig_direct_thread')) {
        const n = normalizeThread(t, null);
        if (n) {
          threads++;
          expect(typeof n.thread.title).toBe('string');
        }
      }
      for (const node of collect(json, 'node')) {
        const n = normalizeMessage(node, { threadId: 't', viewerIgid: 'me', viewerFbid: null, igidForFbid: () => undefined });
        if (n) {
          messages++;
          expect(n.message.timestamp).toBeGreaterThan(0);
        }
      }
    }
    expect(threads + messages).toBeGreaterThan(0);
  });
});
