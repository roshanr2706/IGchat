export type User = {
  id: string;
  username: string;
  fullName: string;
  /** Empty string when the user has no avatar; the UI falls back to initials. */
  avatarUrl: string;
  verified: boolean;
  bio?: string;
};

export type Thread = {
  id: string;
  title: string;
  isGroup: boolean;
  /** Everyone in the thread except the current user. */
  participants: User[];
  adminIds: string[];
  /** Milliseconds since epoch. */
  lastActivityAt: number;
  lastMessagePreview: string;
  unread: boolean;
  muted: boolean;
  avatarUrls: string[];
};

export type Reaction = { emoji: string; userIds: string[] };
export type ReplyRef = { messageId: string; senderId: string; preview: string };
export type MessageStatus = 'sent' | 'pending' | 'failed' | 'uncertain';

export type MessageBase = {
  id: string;
  threadId: string;
  senderId: string;
  timestamp: number;
  reactions: Reaction[];
  replyTo?: ReplyRef;
  status: MessageStatus;
  /** Set on messages created locally (optimistic sends); stays after confirmation so UI keys are stable. */
  clientTempId?: string;
  editedAt?: number;
};

export type MessageBody =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string; width: number; height: number }
  | { kind: 'video'; url: string; thumbUrl: string; width: number; height: number }
  | { kind: 'sharedPost'; postUrl: string; thumbUrl: string; caption?: string; author?: string }
  | { kind: 'reel'; postUrl: string; thumbUrl: string; caption?: string; author?: string }
  | { kind: 'link'; text: string; url: string; title?: string; thumbUrl?: string }
  | { kind: 'like' }
  | { kind: 'actionLog'; text: string }
  | { kind: 'unsupported'; rawType: string };

export type Message = MessageBase & MessageBody;
export type MessageKind = MessageBody['kind'];
export type MediaMessage = Extract<Message, { kind: 'image' | 'video' }>;

export type SyncStatus = 'starting' | 'ok' | 'reconnecting' | 'authExpired' | 'checkpoint';
export type EngineState = 'starting' | 'needsUser' | 'ready' | 'broken';
export type AuthStatus = { loggedIn: boolean; engine: EngineState };
export type Page<T> = { items: T[]; hasMore: boolean };

/** Instagram allows editing a sent message for 15 minutes. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
