import type { Thread } from '../../../shared/types';

const isBoundary = (t: string, i: number): boolean => i === 0 || /[\s._-]/.test(t.charAt(i - 1));

/** Higher is better; null means no match. Prefix > substring > scattered subsequence. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = target.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 500 + (isBoundary(t, idx) ? 100 : 0) - idx;

  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, from);
    if (found < 0) return null;
    score += 1;
    if (found === prev + 1) score += 5;
    if (isBoundary(t, found)) score += 8;
    score -= Math.min(found - from, 10) * 0.5;
    prev = found;
    from = found + 1;
  }
  return score;
}

export function searchThreads(threads: Thread[], query: string, limit = 20): Thread[] {
  if (!query.trim()) return [...threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, limit);
  const scored: { thread: Thread; score: number }[] = [];
  for (const thread of threads) {
    let best: number | null = fuzzyScore(query, thread.title);
    for (const p of thread.participants) {
      for (const field of [p.username, p.fullName]) {
        const s = fuzzyScore(query, field);
        if (s !== null && (best === null || s > best)) best = s;
      }
    }
    if (best !== null) scored.push({ thread, score: best });
  }
  scored.sort((a, b) => b.score - a.score || b.thread.lastActivityAt - a.thread.lastActivityAt);
  return scored.slice(0, limit).map((s) => s.thread);
}
