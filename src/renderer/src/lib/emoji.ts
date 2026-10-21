/**
 * Emoji names, shortcodes and search, from emojibase (Slack/Discord-style iamcal shortcodes such as :wilted_flower:).
 * The data is loaded lazily on first use, so it never weighs on startup.
 */

export type EmojiEntry = { emoji: string; name: string; codes: string[]; tags: string[]; group: number; order: number };
export type EmojiIndex = { all: EmojiEntry[]; byCode: Map<string, string>; byEmoji: Map<string, EmojiEntry>; byGroup: Map<number, EmojiEntry[]> };

/** emojibase group ids, in picker order (2 is skin-tone components, which are not pickable). */
export const EMOJI_GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: 'Smileys & emotion', icon: '😀' },
  { id: 1, label: 'People & body', icon: '👋' },
  { id: 3, label: 'Animals & nature', icon: '🐻' },
  { id: 4, label: 'Food & drink', icon: '🍔' },
  { id: 5, label: 'Travel & places', icon: '✈️' },
  { id: 6, label: 'Activities', icon: '⚽' },
  { id: 7, label: 'Objects', icon: '💡' },
  { id: 8, label: 'Symbols', icon: '❤️' },
  { id: 9, label: 'Flags', icon: '🏁' }
];

type RawEmoji = { unicode: string; label: string; hexcode: string; tags?: string[]; group?: number; order?: number };

let cached: EmojiIndex | null = null;
let loading: Promise<EmojiIndex> | null = null;

export function emojiIndex(): EmojiIndex | null {
  return cached;
}

export function loadEmoji(): Promise<EmojiIndex> {
  if (cached) return Promise.resolve(cached);
  loading ??= Promise.all([import('emojibase-data/en/compact.json'), import('emojibase-data/en/shortcodes/iamcal.json')]).then(([data, codes]) => {
    cached = buildIndex((data.default ?? data) as unknown as RawEmoji[], (codes.default ?? codes) as unknown as Record<string, string | string[]>);
    return cached;
  });
  return loading;
}

function buildIndex(raw: RawEmoji[], shortcodes: Record<string, string | string[]>): EmojiIndex {
  const all: EmojiEntry[] = [];
  for (const r of raw) {
    if (r.group === undefined || r.group === 2 || !r.unicode) continue;
    const sc = shortcodes[r.hexcode];
    const codes = (Array.isArray(sc) ? sc : sc ? [sc] : []).map((c) => c.toLowerCase());
    // Fall back to a code made from the name, so every emoji can be reached by typing.
    if (!codes.length) codes.push(r.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    all.push({ emoji: r.unicode, name: r.label, codes, tags: (r.tags ?? []).map((t) => t.toLowerCase()), group: r.group, order: r.order ?? 0 });
  }
  all.sort((a, b) => a.order - b.order);
  const byCode = new Map<string, string>();
  const byEmoji = new Map<string, EmojiEntry>();
  const byGroup = new Map<number, EmojiEntry[]>();
  for (const e of all) {
    for (const c of e.codes) if (!byCode.has(c)) byCode.set(c, e.emoji);
    byEmoji.set(e.emoji, e);
    byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
  }
  return { all, byCode, byEmoji, byGroup };
}

/** Lower is better; Infinity means no match. */
function score(e: EmojiEntry, q: string): number {
  let best = Infinity;
  for (const c of e.codes) {
    if (c === q) return 0;
    if (c.startsWith(q)) best = Math.min(best, 1 + (c.length - q.length) / 100);
    else if (c.split(/[_-]/).some((part) => part.startsWith(q))) best = Math.min(best, 2 + c.length / 100);
  }
  if (best < Infinity) return best;
  if (e.name.toLowerCase().split(/[\s:-]+/).some((w) => w.startsWith(q))) return 3;
  if (e.tags.some((t) => t.startsWith(q))) return 4;
  if (e.codes.some((c) => c.includes(q)) || e.name.toLowerCase().includes(q)) return 5;
  return Infinity;
}

/** The emoji closest to what was typed after ":", best first (Discord-style). */
export function findEmoji(index: EmojiIndex, query: string, limit = 8): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/^:/, '').replace(/:$/, '');
  if (!q || !/^[a-z0-9_+-]+$/.test(q)) return [];
  const scored: { e: EmojiEntry; s: number }[] = [];
  for (const e of index.all) {
    const s = score(e, q);
    if (s < Infinity) scored.push({ e, s });
  }
  scored.sort((a, b) => a.s - b.s || a.e.order - b.e.order);
  return scored.slice(0, limit).map((x) => x.e);
}

/**
 * The ":token" being typed at the caret, Discord-style: it starts at a word boundary, has at least two characters,
 * and isn't closed yet. Null when the caret isn't in one.
 */
export function shortcodeAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s+(]):([a-z0-9_+-]{2,})$/i.exec(before);
  if (!m) return null;
  const start = before.length - m[2]!.length - 1;
  return { start, query: m[2]! };
}

/** A ":code:" just closed at the caret (Discord converts these as you type). */
export function completedShortcodeAt(text: string, caret: number): { start: number; code: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s+(]):([a-z0-9_+-]{2,}):$/i.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 2, code: m[2]!.toLowerCase() };
}

// Variation selector 16, combining keycap and zero-width joiner, spelled out so the source stays readable.
const VS16 = String.fromCharCode(0xfe0f);
const KEYCAP = String.fromCharCode(0x20e3);
const ZWJ = String.fromCharCode(0x200d);
const PART = String.raw`\p{Extended_Pictographic}(?:${VS16}|\p{Emoji_Modifier})?`;
const ONE_EMOJI = new RegExp(String.raw`^(?:\p{Regional_Indicator}{2}|[#*0-9]${VS16}?${KEYCAP}|${PART}(?:${ZWJ}${PART})*)$`, 'u');

/** "+🥀" or "+:wilted_flower:" alone in the box means "react to the latest message with it". */
export function parseReactCommand(text: string, index: EmojiIndex | null): string | null {
  const t = text.trim();
  if (!t.startsWith('+')) return null;
  const rest = t.slice(1);
  const code = /^:([a-z0-9_+-]+):$/i.exec(rest);
  if (code) return index?.byCode.get(code[1]!.toLowerCase()) ?? null;
  return ONE_EMOJI.test(rest) ? rest : null;
}
