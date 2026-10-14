import type { Message, MessageBase, Thread, User } from '../types';

let n = 0;
const next = (): number => ++n;

export function makeUser(over: Partial<User> = {}): User {
  const i = next();
  return { id: `u${i}`, username: `user${i}`, fullName: `User ${i}`, avatarUrl: '', verified: false, ...over };
}

export function makeThread(over: Partial<Thread> = {}): Thread {
  const i = next();
  const participants = over.participants ?? [makeUser()];
  return {
    id: `t${i}`,
    title: participants.map((p) => p.fullName).join(', '),
    isGroup: participants.length > 1,
    participants,
    adminIds: [],
    lastActivityAt: 1_000_000 + i,
    lastMessagePreview: '',
    unread: false,
    muted: false,
    avatarUrls: [],
    ...over
  };
}

export function makeText(over: Partial<MessageBase> & { text?: string } = {}): Message {
  const i = next();
  const { text = `message ${i}`, ...rest } = over;
  return { id: `m${i}`, threadId: 't1', senderId: 'u1', timestamp: 1_700_000_000_000 + i * 1000, reactions: [], status: 'sent', ...rest, kind: 'text', text };
}

export function makeImage(over: Partial<MessageBase> = {}): Message {
  const i = next();
  return {
    id: `m${i}`,
    threadId: 't1',
    senderId: 'u1',
    timestamp: 1_700_000_000_000 + i * 1000,
    reactions: [],
    status: 'sent',
    ...over,
    kind: 'image',
    url: `data:image/png;base64,AAAA${i}`,
    width: 100,
    height: 100
  };
}
