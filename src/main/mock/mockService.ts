import type { EventChannel, EventMap, ThreadPage } from '../../shared/ipc';
import { messagePreview } from '../../shared/preview';
import { withReaction, withoutReaction } from '../../shared/reactions';
import { EDIT_WINDOW_MS, type Message, type MessageBase, type Page, type Thread, type User } from '../../shared/types';
import { ServiceError, type ChatService } from '../chatService';
import { Emitter } from '../emitter';
import { createSeed, LINES, ME, mulberry32, threadPreview } from './seed';

export type MockOptions = {
  now?: () => number;
  latencyMs?: number;
  /** 0 disables simulated incoming traffic. */
  incomingEveryMs?: number;
  pageSize?: number;
  inboxPageSize?: number;
  seed?: number;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** In-memory fake backend used until the Instagram service (Plan 2) exists. Send a message containing "[fail]" to simulate a failure. */
export class MockChatService implements ChatService {
  private readonly events = new Emitter<EventMap>();
  private readonly now: () => number;
  private readonly latencyMs: number;
  private readonly incomingEveryMs: number;
  private readonly pageSize: number;
  private readonly inboxPageSize: number;
  private readonly rand: () => number;
  private readonly threads: Map<string, Thread>;
  private readonly messages: Map<string, Message[]>;
  private readonly oldestServed = new Map<string, string>();
  private inboxServed = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.latencyMs = opts.latencyMs ?? 250;
    this.incomingEveryMs = opts.incomingEveryMs ?? 20_000;
    this.pageSize = opts.pageSize ?? 30;
    this.inboxPageSize = opts.inboxPageSize ?? 20;
    this.rand = mulberry32((opts.seed ?? 42) + 1);
    const seed = createSeed(this.now(), opts.seed ?? 42);
    this.threads = new Map(seed.threads.map((t) => [t.id, t]));
    this.messages = seed.messages;
  }

  on<E extends EventChannel>(event: E, listener: EventMap[E]): () => void {
    return this.events.on(event, listener);
  }

  start(): void {
    if (this.timer || this.incomingEveryMs <= 0) return;
    this.timer = setInterval(() => this.simulateIncoming(), this.incomingEveryMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async me(): Promise<User> {
    await this.delay();
    return clone(ME);
  }

  async getInbox(): Promise<Page<Thread>> {
    await this.delay();
    this.inboxServed = Math.min(this.inboxPageSize, this.threads.size);
    return this.inboxPage(0, this.inboxServed);
  }

  async loadMoreInbox(): Promise<Page<Thread>> {
    await this.delay();
    const start = this.inboxServed;
    this.inboxServed = Math.min(start + this.inboxPageSize, this.threads.size);
    return this.inboxPage(start, this.inboxServed);
  }

  async openThread(threadId: string): Promise<ThreadPage> {
    await this.delay();
    const all = this.threadMessages(threadId);
    const page = all.slice(Math.max(0, all.length - this.pageSize));
    if (page[0]) this.oldestServed.set(threadId, page[0].id);
    return { messages: clone(page), hasOlder: all.length > page.length };
  }

  async loadOlder(threadId: string): Promise<ThreadPage> {
    await this.delay();
    const all = this.threadMessages(threadId);
    const oldestId = this.oldestServed.get(threadId);
    const end = oldestId ? Math.max(0, all.findIndex((m) => m.id === oldestId)) : all.length;
    const start = Math.max(0, end - this.pageSize);
    const page = all.slice(start, end);
    if (page[0]) this.oldestServed.set(threadId, page[0].id);
    return { messages: clone(page), hasOlder: start > 0 };
  }

  async getThreadDetails(threadId: string): Promise<Thread> {
    await this.delay();
    return clone(this.thread(threadId));
  }

  async markSeen(threadId: string): Promise<void> {
    await this.delay();
    const t = this.thread(threadId);
    if (!t.unread) return;
    t.unread = false;
    this.events.emit('inbox:updated', clone([t]));
  }

  async sendText(threadId: string, text: string, replyToId: string | null): Promise<Message> {
    await this.delay();
    if (text.toLowerCase().includes('[fail]')) throw new ServiceError('Network', 'Simulated send failure');
    const target = replyToId ? this.threadMessages(threadId).find((m) => m.id === replyToId) : undefined;
    const msg: Message = {
      ...this.base(threadId, ME.id),
      ...(target ? { replyTo: { messageId: target.id, senderId: target.senderId, preview: messagePreview(target) } } : {}),
      kind: 'text',
      text
    };
    this.push(threadId, msg, false);
    return clone(msg);
  }

  async sendImage(threadId: string, bytes: Uint8Array, mime: string): Promise<Message> {
    await this.delay();
    if (!mime.startsWith('image/')) throw new ServiceError('Unknown', 'Only images can be sent');
    const url = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    const msg: Message = { ...this.base(threadId, ME.id), kind: 'image', url, width: 0, height: 0 };
    this.push(threadId, msg, false);
    return clone(msg);
  }

  async react(threadId: string, messageId: string, emoji: string): Promise<Message> {
    await this.delay();
    const m = this.message(threadId, messageId);
    m.reactions = withReaction(m.reactions, ME.id, emoji);
    return clone(m);
  }

  async unreact(threadId: string, messageId: string): Promise<Message> {
    await this.delay();
    const m = this.message(threadId, messageId);
    m.reactions = withoutReaction(m.reactions, ME.id);
    return clone(m);
  }

  async editMessage(threadId: string, messageId: string, text: string): Promise<Message> {
    await this.delay();
    const m = this.message(threadId, messageId);
    if (m.senderId !== ME.id || m.kind !== 'text') throw new ServiceError('Unknown', 'Only your own text messages can be edited');
    if (this.now() - m.timestamp > EDIT_WINDOW_MS) throw new ServiceError('EditWindowExpired', 'Too late to edit');
    m.text = text;
    m.editedAt = this.now();
    this.refreshPreview(threadId);
    return clone(m);
  }

  async unsendMessage(threadId: string, messageId: string): Promise<void> {
    await this.delay();
    const list = this.threadMessages(threadId);
    const index = list.findIndex((m) => m.id === messageId);
    if (index < 0) throw new ServiceError('NotFound', 'Message not found');
    if (list[index]!.senderId !== ME.id) throw new ServiceError('Unknown', 'You can only unsend your own messages');
    if (this.oldestServed.get(threadId) === messageId) {
      const next = list[index + 1];
      if (next) this.oldestServed.set(threadId, next.id);
      else this.oldestServed.delete(threadId);
    }
    list.splice(index, 1);
    this.refreshPreview(threadId);
  }

  /** Fake incoming traffic: a new message from someone, or an edit of their recent message. */
  simulateIncoming(kind: 'message' | 'edit' = this.rand() < 0.2 ? 'edit' : 'message'): void {
    const candidates = this.sortedThreads().slice(0, 6);
    const thread = candidates[Math.floor(this.rand() * candidates.length)];
    if (!thread) return;
    const list = this.threadMessages(thread.id);

    if (kind === 'edit') {
      const target = [...list].reverse().find((m) => m.senderId !== ME.id && m.kind === 'text');
      if (target && target.kind === 'text') {
        target.text = `${target.text} (edited)`;
        target.editedAt = this.now();
        this.events.emit('msg:updated', thread.id, clone(target));
        return;
      }
    }

    const sender = thread.participants[Math.floor(this.rand() * thread.participants.length)]!;
    const msg: Message = { ...this.base(thread.id, sender.id), kind: 'text', text: LINES[Math.floor(this.rand() * LINES.length)]! };
    this.push(thread.id, msg, true);
    this.events.emit('msg:new', thread.id, [clone(msg)]);
  }

  private delay(): Promise<void> {
    return this.latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.latencyMs)) : Promise.resolve();
  }

  private sortedThreads(): Thread[] {
    return [...this.threads.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  private inboxPage(start: number, end: number): Page<Thread> {
    const all = this.sortedThreads();
    return { items: clone(all.slice(start, end)), hasMore: end < all.length };
  }

  private thread(threadId: string): Thread {
    const t = this.threads.get(threadId);
    if (!t) throw new ServiceError('NotFound', `Unknown thread ${threadId}`);
    return t;
  }

  private threadMessages(threadId: string): Message[] {
    this.thread(threadId);
    const list = this.messages.get(threadId) ?? [];
    this.messages.set(threadId, list);
    return list;
  }

  private message(threadId: string, messageId: string): Message {
    const m = this.threadMessages(threadId).find((x) => x.id === messageId);
    if (!m) throw new ServiceError('NotFound', 'Message not found');
    return m;
  }

  private base(threadId: string, senderId: string): MessageBase {
    return { id: `mock-${++this.seq}-${this.now()}`, threadId, senderId, timestamp: this.now(), reactions: [], status: 'sent' };
  }

  private push(threadId: string, msg: Message, incoming: boolean): void {
    this.threadMessages(threadId).push(msg);
    const t = this.thread(threadId);
    t.lastActivityAt = msg.timestamp;
    t.lastMessagePreview = threadPreview(msg);
    if (incoming) t.unread = true;
    this.events.emit('inbox:updated', clone([t]));
  }

  private refreshPreview(threadId: string): void {
    const t = this.thread(threadId);
    const list = this.threadMessages(threadId);
    const last = list[list.length - 1];
    t.lastMessagePreview = last ? threadPreview(last) : '';
    this.events.emit('inbox:updated', clone([t]));
  }
}
