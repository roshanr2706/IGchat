import type { ErrorCode, EventChannel, EventMap, ThreadPage } from '../shared/ipc';
import type { Message, Page, Thread, User } from '../shared/types';

/** Everything the app needs from a chat backend. MockChatService (Plan 1) and the Instagram service (Plan 2) implement it. */
export interface ChatService {
  me(): Promise<User>;
  getInbox(): Promise<Page<Thread>>;
  loadMoreInbox(): Promise<Page<Thread>>;
  openThread(threadId: string): Promise<ThreadPage>;
  loadOlder(threadId: string): Promise<ThreadPage>;
  getThreadDetails(threadId: string): Promise<Thread>;
  markSeen(threadId: string): Promise<void>;
  sendText(threadId: string, text: string, replyToId: string | null): Promise<Message>;
  sendImage(threadId: string, bytes: Uint8Array, mime: string): Promise<Message>;
  react(threadId: string, messageId: string, emoji: string): Promise<Message>;
  unreact(threadId: string, messageId: string): Promise<Message>;
  editMessage(threadId: string, messageId: string, text: string): Promise<Message>;
  unsendMessage(threadId: string, messageId: string): Promise<void>;
  on<E extends EventChannel>(event: E, listener: EventMap[E]): () => void;
  start(): void;
  stop(): void;
}

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
