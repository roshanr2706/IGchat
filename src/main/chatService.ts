import type { ErrorCode, EventChannel, EventMap, ThreadPage } from '../shared/ipc';
import type { AuthStatus, Message, Page, Thread, User } from '../shared/types';

/**
 * Everything the app needs from a chat backend. MockChatService and IgChatService implement it.
 *
 * Event semantics:
 * - `inbox:updated` carries full snapshots of only the threads that changed.
 * - `msg:new` carries messages the renderer has not been given by a direct call, including echoes of the
 *   user's own sends; an echo of a send made through this service carries the send's `clientTempId`.
 * - `msg:updated` carries a full replacement for a message (edits, reactions).
 * - `msg:removed` covers unsends by anyone.
 * - `sync:status` reports connection/engine state.
 */
export interface ChatService {
  me(): Promise<User>;
  getInbox(): Promise<Page<Thread>>;
  loadMoreInbox(): Promise<Page<Thread>>;
  openThread(threadId: string): Promise<ThreadPage>;
  loadOlder(threadId: string): Promise<ThreadPage>;
  getThreadDetails(threadId: string): Promise<Thread>;
  markSeen(threadId: string): Promise<void>;
  /** People search (Instagram's own search when available). */
  searchPeople(query: string): Promise<User[]>;
  /** The 1:1 conversation with this person, opening it on Instagram's side if needed. */
  openThreadWithUser(userId: string): Promise<Thread>;
  sendText(threadId: string, text: string, replyToId: string | null, clientTempId?: string): Promise<Message>;
  sendImage(threadId: string, bytes: Uint8Array, mime: string, clientTempId?: string): Promise<Message>;
  react(threadId: string, messageId: string, emoji: string): Promise<Message>;
  unreact(threadId: string, messageId: string): Promise<Message>;
  editMessage(threadId: string, messageId: string, text: string): Promise<Message>;
  unsendMessage(threadId: string, messageId: string): Promise<void>;
  /** The conversation the user is looking at (null when none). Drives engine navigation. */
  setActiveThread(threadId: string | null): void;
  /** Whether the app window has focus. Drives fallback poll pacing. */
  setFocused(focused: boolean): void;
  authStatus(): Promise<AuthStatus>;
  /** Shows Instagram's own login/challenge page to the user. Never handles credentials. */
  login(): Promise<void>;
  logout(): Promise<void>;
  on<E extends EventChannel>(event: E, listener: EventMap[E]): () => void;
  start(): void;
  stop(): void;
}

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** True when the request may already have reached Instagram, so a blind retry could duplicate it. */
    readonly ambiguous = false
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
