// Builds anonymized normalize fixtures from the newest local capture (.ig-capture/<run>/).
// Output: src/main/ig/__fixtures__/real/*.json (git-ignored). Run: node tools/make-fixtures.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const captures = join(root, '.ig-capture');
const run = readdirSync(captures).sort().at(-1);
if (!run) throw new Error('No capture found in .ig-capture/');
const dir = join(captures, run);
const out = join(root, 'src', 'main', 'ig', '__fixtures__', 'real');
mkdirSync(out, { recursive: true });

const WANT = new Set(['IGDThreadListOffMsysPaginationQuery', 'IGDMessageListOffMsysQuery', 'IGDThreadDetailQuery']);
const TEXT_KEYS = /^(text_body|igd_snippet|xma_text_body|caption_body_text|thread_title|full_name|username|name|biography|header_title_text|title_text|subtitle_text|header_subtitle_text|eyebrow_text|alt_text|body|nickname|sensitive_string_value)$/;
const ids = new Map();
let n = 0;
const fakeDigits = (s) => {
  if (!ids.has(s)) ids.set(s, String(++n).padStart(s.length, '7').slice(-s.length));
  return ids.get(s);
};
const anon = (v, key = '') => {
  if (Array.isArray(v)) return v.map((x) => anon(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, anon(x, k)]));
  if (typeof v !== 'string') return v;
  if (TEXT_KEYS.test(key)) return v ? `${key}-${++n}` : v;
  if (/url/i.test(key) && /^https?:/i.test(v)) {
    if (/instagram\.com\/(reels?|p|tv)\//i.test(v)) return v.replace(/(instagram\.com\/(?:reels?|p|tv)\/)[^/?#]+/i, `$1ANON${++n}`);
    if (/cdninstagram\.com|fbcdn\.net/i.test(v)) return `https://scontent.cdninstagram.com/anon/${++n}.jpg`;
    return `https://example.com/anon/${++n}`;
  }
  if (/^\d{8,}$/.test(v)) return fakeDigits(v);
  if (/^mid\./.test(v)) return `mid.$anon${fakeDigits(v.replace(/\D/g, '').slice(0, 12) || '1')}`;
  return v;
};

let written = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('-http.json'))) {
  const entry = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const name = new URLSearchParams(typeof entry.postData === 'string' ? entry.postData : '').get('fb_api_req_friendly_name');
  if (!WANT.has(name) || !entry.response || typeof entry.response !== 'object') continue;
  writeFileSync(join(out, `${name}-${f}`), JSON.stringify(anon(entry.response), null, 2));
  written++;
}
console.log(`Wrote ${written} anonymized fixtures to ${out}`);
