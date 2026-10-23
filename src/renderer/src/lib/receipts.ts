import type { Message, Thread, User } from '../../../shared/types';
import { formatTime, sameDay } from './time';

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function readTime(at: number, now: number): string {
  if (sameDay(at, now)) return `Read at ${formatTime(at)}`;
  if (sameDay(at, now - 86_400_000)) return `Read yesterday at ${formatTime(at)}`;
  return `Read ${monthDay.format(at)} at ${formatTime(at)}`;
}

/**
 * The hover label for each of your own messages someone has read, keyed by message id. In a DM the newest message
 * they've read gets the time ("Read at 3:42 PM"); earlier ones just "Read", since Instagram only says how far they
 * have read, not when each message was. In a group: who has read it.
 */
export function readLabels(thread: Thread, list: Message[], myId: string, users: Map<string, User>, now: number): Map<string, string> {
  const out = new Map<string, string>();
  const others = new Set(thread.participants.map((p) => p.id));
  const receipts = (thread.readReceipts ?? []).filter((r) => r.userId !== myId && others.has(r.userId));
  if (!receipts.length) return out;
  const mine = list.filter((m) => m.senderId === myId && m.status === 'sent' && m.kind !== 'actionLog');
  if (!thread.isGroup) {
    const r = receipts[0]!;
    const read = mine.filter((m) => m.timestamp <= r.watermark);
    read.forEach((m, i) => out.set(m.id, i === read.length - 1 ? readTime(r.at, now) : 'Read'));
    return out;
  }
  const name = (id: string): string => users.get(id)?.fullName || users.get(id)?.username || 'Someone';
  for (const m of mine) {
    const readers = receipts.filter((r) => r.watermark >= m.timestamp).map((r) => name(r.userId));
    if (!readers.length) continue;
    if (readers.length === others.size && others.size > 1) out.set(m.id, 'Read by everyone');
    else out.set(m.id, `Read by ${readers.slice(0, 3).join(', ')}${readers.length > 3 ? ` and ${readers.length - 3} more` : ''}`);
  }
  return out;
}
