import { EDIT_WINDOW_MS, type Message } from '../../../shared/types';

export function canEdit(m: Message, myId: string, now: number): boolean {
  return m.senderId === myId && m.kind === 'text' && m.status === 'sent' && now - m.timestamp <= EDIT_WINDOW_MS;
}

export function canUnsend(m: Message, myId: string): boolean {
  return m.senderId === myId && m.status === 'sent';
}

/** Discord-style "↑ to edit": the most recent own sent message, if it can still be edited. */
export function lastEditable(messages: Message[], myId: string, now: number): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.senderId === myId && m.status === 'sent') return canEdit(m, myId, now) ? m : null;
  }
  return null;
}
