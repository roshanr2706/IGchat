import type { Message } from '../../../shared/types';
import { sameDay, startOfDay } from './time';

export const GROUP_WINDOW_MS = 7 * 60 * 1000;

export type ListRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: Message; showHeader: boolean };

/** Turns messages (oldest first) into list rows with day dividers, an unread marker and Discord-style header grouping. */
export function buildRows(messages: Message[], opts: { firstUnreadId?: string | null; dayLabel: (ts: number) => string }): ListRow[] {
  const rows: ListRow[] = [];
  let prev: Message | null = null;
  for (const m of messages) {
    let forceHeader = false;
    if (!prev || !sameDay(prev.timestamp, m.timestamp)) {
      rows.push({ type: 'day', key: `day-${startOfDay(m.timestamp)}`, label: opts.dayLabel(m.timestamp) });
      forceHeader = true;
    }
    if (opts.firstUnreadId && m.id === opts.firstUnreadId) {
      rows.push({ type: 'unread', key: 'unread-marker' });
      forceHeader = true;
    }
    const showHeader =
      m.kind !== 'actionLog' &&
      (forceHeader ||
        prev === null ||
        prev.kind === 'actionLog' ||
        prev.senderId !== m.senderId ||
        m.timestamp - prev.timestamp > GROUP_WINDOW_MS ||
        m.replyTo !== undefined);
    rows.push({ type: 'message', key: m.clientTempId ?? m.id, message: m, showHeader });
    prev = m;
  }
  return rows;
}
