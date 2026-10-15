import type { Settings } from './settings';
import type { ThemeDef } from './theme';
import type { Message, Page, SyncStatus, Thread, User } from './types';

export type ErrorCode = 'AuthExpired' | 'Checkpoint' | 'RateLimited' | 'Network' | 'EditWindowExpired' | 'NotFound' | 'Unknown';
export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

export type ThreadPage = { messages: Message[]; hasOlder: boolean };
export type CustomThemes = { themes: ThemeDef[]; errors: string[] };

/** Renderer → main request/response channels. */
export interface InvokeMap {
  'session:me': () => User;
  'inbox:get': () => Page<Thread>;
  'inbox:loadMore': () => Page<Thread>;
  'thread:open': (threadId: string) => ThreadPage;
  'thread:loadOlder': (threadId: string) => ThreadPage;
  'thread:details': (threadId: string) => Thread;
  'thread:markSeen': (threadId: string) => void;
  'msg:sendText': (threadId: string, text: string, replyToId: string | null) => Message;
  'msg:sendImage': (threadId: string, bytes: Uint8Array, mime: string) => Message;
  'msg:react': (threadId: string, messageId: string, emoji: string) => Message;
  'msg:unreact': (threadId: string, messageId: string) => Message;
  'msg:edit': (threadId: string, messageId: string, text: string) => Message;
  'msg:unsend': (threadId: string, messageId: string) => void;
  'settings:set': (patch: Partial<Settings>) => Settings;
  'themes:listCustom': () => CustomThemes;
  'themes:openFolder': () => void;
  'shell:openExternal': (url: string) => void;
}
export type InvokeChannel = keyof InvokeMap;
export type InvokeArgs<C extends InvokeChannel> = Parameters<InvokeMap[C]>;
export type InvokeReturn<C extends InvokeChannel> = ReturnType<InvokeMap[C]>;

/** Main → renderer push events. */
export interface EventMap {
  /** Only the threads that changed. */
  'inbox:updated': (threads: Thread[]) => void;
  'msg:new': (threadId: string, messages: Message[]) => void;
  'msg:updated': (threadId: string, message: Message) => void;
  'msg:removed': (threadId: string, messageId: string) => void;
  'sync:status': (status: SyncStatus) => void;
}
export type EventChannel = keyof EventMap;

export const INVOKE_CHANNELS = [
  'session:me',
  'inbox:get',
  'inbox:loadMore',
  'thread:open',
  'thread:loadOlder',
  'thread:details',
  'thread:markSeen',
  'msg:sendText',
  'msg:sendImage',
  'msg:react',
  'msg:unreact',
  'msg:edit',
  'msg:unsend',
  'settings:set',
  'themes:listCustom',
  'themes:openFolder',
  'shell:openExternal'
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = ['inbox:updated', 'msg:new', 'msg:updated', 'msg:removed', 'sync:status'] as const satisfies readonly EventChannel[];

// Compile-time exhaustiveness: adding a channel to a map without listing it above is a type error.
type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
type MissingEvent = Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>;
export const invokeChannelsExhaustive: [MissingInvoke] extends [never] ? true : false = true;
export const eventChannelsExhaustive: [MissingEvent] extends [never] ? true : false = true;

/** Synchronous channel the preload uses to read settings before first paint. */
export const SETTINGS_SYNC_CHANNEL = 'settings:getSync';

/** The object the preload exposes as `window.ig`. */
export interface Bridge {
  initialSettings: Settings;
  /** Custom themes, delivered with the synchronous startup payload so a saved custom theme paints correctly on first frame. */
  initialCustomThemes: ThemeDef[];
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<Result<InvokeReturn<C>>>;
  on<E extends EventChannel>(event: E, listener: EventMap[E]): () => void;
}
