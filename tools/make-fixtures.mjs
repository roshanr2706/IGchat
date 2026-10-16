// Builds anonymized normalize fixtures from the newest local capture (.ig-capture/<run>/).
// Allow-list anonymizer: only structural values survive; every other string becomes a fake value.
// Output: src/main/ig/__fixtures__/real/*.json (git-ignored). Run: node tools/make-fixtures.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const captures = join(root, '.ig-capture');
const run = readdirSync(captures).sort().at(-1);
if (!run) throw new Error('No capture found in .ig-capture/');
const dir = join(captures, run);
const out = join(root, 'src', 'main', 'ig', '__fixtures__', 'real');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const WANT = new Set(['IGDThreadListOffMsysPaginationQuery', 'IGDMessageListOffMsysQuery', 'IGDThreadDetailQuery']);
const KEEP_STRING_KEYS = new Set(['__typename', '__isSlideMessageContent', '__isShareSheetItem', 'content_type', 'reaction_status']);
const KEEP_NUMBER_KEYS = new Set(['width', 'height', 'preview_width', 'preview_height', 'count']);
const isTimeKey = (k) => /timestamp/i.test(k) || /_ms$/i.test(k);

// Pre-pass: every original string/key, so fake values never collide with one.
const entries = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('-http.json'))) {
  const entry = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const name = new URLSearchParams(typeof entry.postData === 'string' ? entry.postData : '').get('fb_api_req_friendly_name');
  if (!WANT.has(name) || !entry.response || typeof entry.response !== 'object') continue;
  entries.push({ f, name, response: entry.response });
}
const allOrig = new Set();
const keyNames = new Set();
const keptValues = new Set();

let n = 0;
const strings = new Map();
const digits = new Map();
const once = (map, s, make) => {
  if (!map.has(s)) map.set(s, make());
  return map.get(s);
};
const fresh = (make) => {
  for (let i = 0; i < 100000; i++) {
    const c = make();
    if (!allOrig.has(c)) return c;
  }
  throw new Error('could not generate a collision-free fake value');
};
const fakeDigits = (s) => once(digits, s, () => fresh(() => String(++n).padStart(s.length, '7').slice(-s.length)));

const anonString = (v) => {
  if (v === '') return v;
  if (/^\d+$/.test(v)) return fakeDigits(v);
  if (/^https?:\/\//i.test(v)) {
    return once(strings, v, () => {
      let host = '';
      let path = '';
      try {
        const u = new URL(v);
        host = u.hostname;
        path = u.pathname;
      } catch {}
      if (/(^|\.)instagram\.com$/i.test(host)) {
        const m = /^\/(reels?|p|tv)\//i.exec(path);
        if (m) return `https://www.instagram.com/${m[1].toLowerCase()}/ANON${++n}/`;
      }
      if (/(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(host)) return `https://scontent.cdninstagram.com/anon/${++n}.jpg`;
      return `https://example.com/anon/${++n}`;
    });
  }
  if (/^mid\./.test(v)) return once(strings, v, () => fresh(() => `mid.$anon${++n}`));
  return once(strings, v, () => fresh(() => `s${++n}`));
};

const anonKey = (k) => (/^\d+$/.test(k) ? fakeDigits(k) : k);

const anon = (v, key = '') => {
  if (Array.isArray(v)) return v.map((x) => anon(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [anonKey(k), anon(x, k)]));
  if (typeof v === 'string') {
    if (KEEP_STRING_KEYS.has(key)) return v;
    if (isTimeKey(key) && /^\d+$/.test(v)) return v;
    return anonString(v);
  }
  if (typeof v === 'number') return KEEP_NUMBER_KEYS.has(key) || isTimeKey(key) ? v : 0;
  return v; // booleans, null
};

const isKept = (key, v) => KEEP_STRING_KEYS.has(key) || (isTimeKey(key) && /^\d+$/.test(v));

const walk = (v, key, onKey, onString) => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, key, onKey, onString));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      onKey(k);
      walk(x, k, onKey, onString);
    }
  } else if (typeof v === 'string') onString(v, key);
};

// Allow-listed values and key names are structure, not content.
const originals = new Set();
for (const e of entries) {
  walk(e.response, '', (k) => {
    if (/^\d+$/.test(k)) {
      allOrig.add(k);
      if (k.length >= 3) originals.add(k);
    } else keyNames.add(k);
  }, (s, key) => {
    allOrig.add(s);
    if (isKept(key, s)) keptValues.add(s);
    else if (s.length >= 3) originals.add(s);
  });
}
for (const k of keyNames) allOrig.add(k);

let written = 0;
const outputs = new Set();
for (const e of entries) {
  const result = anon(e.response);
  walk(result, '', (k) => outputs.add(k), (s) => outputs.add(s));
  writeFileSync(join(out, `${e.name}-${e.f}`), JSON.stringify(result, null, 2));
  written++;
}

// Leak check: a changed original must not appear in the output (schema words and kept values excepted).
let leaks = 0;
for (const s of originals) if (outputs.has(s) && !keptValues.has(s) && !keyNames.has(s)) leaks++;
if (leaks > 0) {
  rmSync(out, { recursive: true, force: true });
  console.error(`Anonymization check failed: ${leaks} original value(s) found in output. Output deleted.`);
  process.exit(1);
}
console.log(`Wrote ${written} anonymized fixtures (leak check passed, ${originals.size} originals checked)`);
