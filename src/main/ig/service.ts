import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventChannel, EventMap, ThreadPage } from '../../shared/ipc';
import { messagePreview } from '../../shared/preview';
import { withReaction, withoutReaction } from '../../shared/reactions';
import { EDIT_WINDOW_MS, type AuthStatus, type Message, type Page, type SyncStatus, type Thread, type User } from '../../shared/types';
import { ServiceError, type ChatService } from '../chatService';
import type { RelayStatus } from '../engine/relayFeed';
import type { EngineLike, GraphQLObservation, RelayDelta, RelaySnapshot } from '../engine/types';
import { normalizeUser } from './normalize';
import {
  editVars, extractEditResult, extractMessageListPage, extractReactions, extractSendResult, extractThreadListPage, extractUnsendResult,
  generateOtid, messageListVars, OPS, reactVars, sendTextVars, threadListVars, unsendVars
} from './ops';
import type { IgStore } from './store';

export interface RelayLike {
  readonly status: RelayStatus;
  snapshot(): Promise<RelaySnapshot | null>;
}

export interface ExecLike {
  run<T = unknown>(name: string, variables: unknown): Promise<T>;
}

export interface CacheLike {
  loadThreads(): Thread[];
  saveThreads(threads: Thread[]): void;
  clear(): void;
}

export type IgServiceDeps = {
  engine: EngineLike;
  relay: RelayLike;
  exec: ExecLike;
  store: IgStore;
  cache?: CacheLike;
  tmpDir: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeouts?: Partial<{ ready: number; openThread: number; imageEcho: number }>;
};

const TIMEOUTS = { ready: 20_000, openThread: 4_000, imageEcho: 30_000 };
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const POLL_MS = 100;

const messageIdOf = (node: unknown): string | undefined => {
  const r = node && typeof node === 'object' ? (node as Record<string, unknown>) : null;
  const v = r?.message_id ?? r?.id;
  return typeof v === 'string' ? v : undefined;
};

/** The real Instagram backend: Instagram's own web app in a hidden engine window, observed and driven. */
export class IgChatService implements ChatService {
  private activeThreadId: string | null = null;
  private focused = true;
  private inboxCursor: string | null = null;
  private inboxHasMore = false;
  private readonly hasOlder = new Map<string, boolean>();
  private offs: (() => void)[] = [];
  private imageQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: IgServiceDeps) {}

  get isFocused(): boolean {
    return this.focused;
  }

  get activeThread(): string | null {
    return this.activeThreadId;
  }

  private get store(): IgStore {
    return this.deps.store;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private timeout(key: keyof typeof TIMEOUTS): number {
    return this.deps.timeouts?.[key] ?? TIMEOUTS[key];
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
  }

  private get viewerId(): string {
    return this.store.viewer?.id ?? 'me';
  }

  on<E extends EventChannel>(event: E, listener: EventMap[E]): () => void {
    return this.store.events.on(event, listener);
  }

  start(): void {
    this.offs.push(this.deps.engine.events.on('state', () => this.emitStatus()));
    if (this.deps.cache) {
      const cache = this.deps.cache;
      this.offs.push(this.store.events.on('inbox:updated', () => cache.saveThreads(this.store.threads())));
    }
    this.emitStatus();
    // The engine recovers by itself (bounded); never stop()/start() it from here, that would reset its reload cap.
    void this.deps.engine.start().catch(() => this.store.events.emit('sync:status', 'reconnecting'));
  }

  stop(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    this.deps.engine.stop();
  }

  syncStatus(): SyncStatus {
    switch (this.deps.engine.state) {
      case 'starting':
        return 'starting';
      case 'needsUser':
        return this.deps.engine.needsUserReason === 'challenge' ? 'checkpoint' : 'authExpired';
      case 'broken':
        return 'reconnecting';
      default:
        return 'ok';
    }
  }

  private emitStatus(): void {
    this.store.events.emit('sync:status', this.syncStatus());
  }

  private async ready(): Promise<void> {
    const { engine } = this.deps;
    if (engine.state === 'ready') return;
    if (engine.state === 'needsUser') throw new ServiceError('AuthExpired', 'Log in to Instagram');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new ServiceError('EngineNotReady', 'Instagram is still loading'));
      }, this.timeout('ready'));
      const off = engine.events.on('state', (s) => {
        if (s === 'ready') {
          clearTimeout(timer);
          off();
          resolve();
        } else if (s === 'needsUser') {
          clearTimeout(timer);
          off();
          reject(new ServiceError('AuthExpired', 'Log in to Instagram'));
        }
      });
    });
  }

  private async waitFor(pred: () => boolean, ms: number): Promise<boolean> {
    for (let waited = 0; ; waited += POLL_MS) {
      if (pred()) return true;
      if (waited >= ms) return false;
      await this.sleep(POLL_MS);
    }
  }

  private async loadSnapshot(): Promise<boolean> {
    const snap = await this.deps.relay.snapshot();
    if (!snap) return false;
    const viewer = normalizeUser(snap.viewer);
    const raw = snap.viewer as Record<string, unknown>;
    if (viewer) this.store.setViewer(viewer.user, typeof raw.fbid === 'string' ? raw.fbid : viewer.fbid || null);
    this.store.ingestThreads(snap.threads, { silent: true });
    this.store.ingestMessages(snap.messages, { silent: true });
    this.inboxCursor = snap.inbox.endCursor;
    this.inboxHasMore = snap.inbox.hasMore;
    return true;
  }

  private async fetchInboxPage(cursor: string | null, silent: boolean): Promise<Thread[]> {
    const fbid = this.store.viewerFbid;
    if (!fbid) throw new ServiceError('EngineNotReady', 'Instagram is still loading');
    const page = extractThreadListPage(await this.deps.exec.run(OPS.threadList, threadListVars(fbid, cursor)));
    const threads = this.store.ingestThreads(page.nodes, { silent });
    this.inboxCursor = page.endCursor;
    this.inboxHasMore = page.hasMore;
    return threads;
  }

  async me(): Promise<User> {
    if (this.store.viewer?.username) return this.store.viewer;
    await this.ready();
    await this.loadSnapshot();
    if (this.store.viewer) return this.store.viewer;
    throw new ServiceError('EngineNotReady', 'Instagram is still loading');
  }

  async getInbox(): Promise<Page<Thread>> {
    if (this.deps.engine.state !== 'ready') {
      const cached = this.deps.cache?.loadThreads() ?? [];
      if (cached.length && this.deps.engine.state === 'starting') return { items: cached, hasMore: false };
    }
    await this.ready();
    if (!(await this.loadSnapshot())) await this.fetchInboxPage(null, true);
    return { items: this.store.threads(), hasMore: this.inboxHasMore };
  }

  async loadMoreInbox(): Promise<Page<Thread>> {
    await this.ready();
    if (!this.inboxHasMore) return { items: [], hasMore: false };
    const items = await this.fetchInboxPage(this.inboxCursor, true);
    return { items, hasMore: this.inboxHasMore };
  }

  async openThread(threadId: string): Promise<ThreadPage> {
    this.activeThreadId = threadId;
    await this.ready();
    // Navigation is best effort: if the page can't open the thread, the query fallback below still serves it.
    void this.deps.engine.navigateToThread(threadId).catch(() => {});
    // The page loads the thread into its own store; the relay delivers it. Fall back to a query if it doesn't.
    await this.waitFor(() => this.store.messagesOf(threadId).length > 0, this.timeout('openThread'));
    if (this.store.messagesOf(threadId).length === 0) {
      const page = extractMessageListPage(await this.deps.exec.run(OPS.messageList, messageListVars(threadId, null)));
      this.store.ingestMessages(page.nodes, { silent: true, threadId });
      this.hasOlder.set(threadId, page.hasOlder);
    }
    return {
      messages: this.store.messagesOf(threadId).slice(-60),
      hasOlder: this.hasOlder.get(threadId) ?? true,
      lastSeenMessageId: this.store.lastSeenMessageId(threadId)
    };
  }

  async loadOlder(threadId: string): Promise<ThreadPage> {
    await this.ready();
    const oldest = this.store.messagesOf(threadId)[0];
    const page = extractMessageListPage(await this.deps.exec.run(OPS.messageList, messageListVars(threadId, oldest?.id ?? null)));
    const got = this.store.ingestMessages(page.nodes, { silent: true, threadId });
    this.hasOlder.set(threadId, page.hasOlder);
    const cutoff = oldest?.timestamp ?? Number.POSITIVE_INFINITY;
    return { messages: got.filter((m) => m.timestamp < cutoff).sort((a, b) => a.timestamp - b.timestamp), hasOlder: page.hasOlder };
  }

  async getThreadDetails(threadId: string): Promise<Thread> {
    const t = this.store.thread(threadId);
    if (!t) throw new ServiceError('NotFound', 'Unknown conversation');
    return t;
  }

  /** Instagram's page marks a thread read itself when it is opened (see openThread), as a browser would. */
  async markSeen(_threadId: string): Promise<void> {}

  async sendText(threadId: string, text: string, replyToId: string | null, clientTempId?: string): Promise<Message> {
    await this.ready();
    const otid = generateOtid(this.now());
    if (clientTempId) this.store.registerPending(otid, clientTempId);
    let data: unknown;
    try {
      data = await this.deps.exec.run(OPS.sendText, sendTextVars(threadId, text, otid, replyToId));
    } catch (err) {
      this.store.dropPending(otid);
      throw err;
    }
    const res = extractSendResult(data);
    if (!res) {
      this.store.dropPending(otid);
      throw new ServiceError('Unknown', "Instagram didn't confirm the message");
    }
    const echoed = this.store.find(threadId, res.messageId);
    if (echoed) return echoed;
    const reply = replyToId ? this.store.find(threadId, replyToId) : undefined;
    const message: Message = {
      id: res.messageId,
      threadId,
      senderId: this.viewerId,
      timestamp: res.timestampMs,
      reactions: [],
      status: 'sent',
      ...(clientTempId ? { clientTempId } : {}),
      ...(reply ? { replyTo: { messageId: reply.id, senderId: reply.senderId, preview: messagePreview(reply) } } : {}),
      kind: 'text',
      text
    };
    this.store.upsertOwn(message);
    return message;
  }

  sendImage(threadId: string, bytes: Uint8Array, mime: string, clientTempId?: string): Promise<Message> {
    const ext = IMAGE_EXT[mime];
    if (!ext) return Promise.reject(new ServiceError('Unknown', 'Only PNG, JPEG, GIF and WebP images can be sent'));
    // One image at a time: each send must be able to tell which echo is its own.
    const run = this.imageQueue.then(() => this.sendImageNow(threadId, bytes, ext, clientTempId));
    this.imageQueue = run.catch(() => {});
    return run;
  }

  private async sendImageNow(threadId: string, bytes: Uint8Array, ext: string, clientTempId?: string): Promise<Message> {
    await this.ready();
    const file = join(this.deps.tmpDir, `igchat-upload-${this.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
    await writeFile(file, bytes);
    const before = new Set(this.store.messagesOf(threadId).map((m) => m.id));
    const isNewOwnImage = (m: Message): boolean => !before.has(m.id) && m.senderId === this.viewerId && m.kind === 'image';
    try {
      // attachImage throws only before the file is handed to the page (safe to report and retry). Once it resolves
      // the image may already be on its way, so from here only the echo decides, and a missing echo is never retryable.
      await this.deps.engine.attachImage(threadId, file);
      await this.waitFor(() => this.store.messagesOf(threadId).some(isNewOwnImage), this.timeout('imageEcho'));
      const sent = this.store.messagesOf(threadId).filter(isNewOwnImage).at(-1);
      if (!sent) throw new ServiceError('Unknown', "Instagram didn't confirm the image. It may have been sent, so check the conversation before sending it again");
      const tagged = clientTempId ? { ...sent, clientTempId } : sent;
      this.store.upsertOwn(tagged);
      return tagged;
    } finally {
      // Removed only after the echo wait: the page reads the file lazily after it is handed over.
      await unlink(file).catch(() => {});
    }
  }

  async editMessage(threadId: string, messageId: string, text: string): Promise<Message> {
    await this.ready();
    const m = this.store.find(threadId, messageId);
    if (!m || m.senderId !== this.viewerId || m.kind !== 'text') throw new ServiceError('Unknown', 'Only your own text messages can be edited');
    if (this.now() - m.timestamp > EDIT_WINDOW_MS) throw new ServiceError('EditWindowExpired', 'Too late to edit');
    const data = await this.deps.exec.run(OPS.edit, editVars(threadId, messageId, text, generateOtid(this.now())));
    if (!extractEditResult(data)) throw new ServiceError('Unknown', "Instagram didn't confirm the edit");
    const updated: Message = { ...m, text, editedAt: this.now() };
    this.store.upsertOwn(updated);
    return updated;
  }

  async unsendMessage(threadId: string, messageId: string): Promise<void> {
    await this.ready();
    const key = this.store.threadKey(threadId);
    if (!key) throw new ServiceError('NotFound', 'Unknown conversation');
    const ok = extractUnsendResult(await this.deps.exec.run(OPS.unsend, unsendVars(messageId, key)));
    if (!ok) throw new ServiceError('Unknown', "Instagram didn't unsend the message");
    this.store.remove(threadId, messageId, true);
  }

  react(threadId: string, messageId: string, emoji: string): Promise<Message> {
    return this.sendReaction(threadId, messageId, emoji, false);
  }

  unreact(threadId: string, messageId: string): Promise<Message> {
    const mine = this.store.find(threadId, messageId)?.reactions.find((r) => r.userIds.includes(this.viewerId))?.emoji ?? '';
    return this.sendReaction(threadId, messageId, mine, true);
  }

  private async sendReaction(threadId: string, messageId: string, emoji: string, remove: boolean): Promise<Message> {
    await this.ready();
    const m = this.store.find(threadId, messageId);
    if (!m) throw new ServiceError('NotFound', 'Message not found');
    const data = await this.deps.exec.run(OPS.react, reactVars(threadId, messageId, this.store.itemIdOf(messageId) ?? messageId, emoji, remove));
    const raws = extractReactions(data);
    const applied = raws ? this.store.applyReactions(threadId, messageId, raws) : null;
    if (applied) return applied;
    const next = { ...m, reactions: remove ? withoutReaction(m.reactions, this.viewerId) : withReaction(m.reactions, this.viewerId, emoji) };
    this.store.upsertOwn(next);
    return next;
  }

  setActiveThread(threadId: string | null): void {
    this.activeThreadId = threadId;
    if (threadId && this.deps.engine.state === 'ready') void this.deps.engine.navigateToThread(threadId).catch(() => {});
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  async authStatus(): Promise<AuthStatus> {
    return { loggedIn: await this.deps.engine.isLoggedIn(), engine: this.deps.engine.state };
  }

  async login(): Promise<void> {
    this.deps.engine.showForUser();
  }

  async logout(): Promise<void> {
    await this.deps.engine.logout();
    this.store.clear();
    this.deps.cache?.clear();
    this.hasOlder.clear();
    this.inboxCursor = null;
    this.inboxHasMore = false;
    this.emitStatus();
  }

  /** Live changes pushed by the relay bridge. */
  async applyDelta(delta: RelayDelta): Promise<void> {
    this.store.ingestThreads(delta.threads);
    this.store.ingestMessages(delta.messages);
    if (delta.removed.length) await this.verifyRemovals(delta.removed);
  }

  /** A record vanishing from the page's store can mean an unsend or just cache cleanup; confirm before removing. */
  private async verifyRemovals(ids: string[]): Promise<void> {
    const byThread = new Map<string, { messageId: string; timestamp: number }[]>();
    for (const c of this.store.candidatesForRemoval(ids)) byThread.set(c.threadId, [...(byThread.get(c.threadId) ?? []), c]);
    for (const [threadId, candidates] of byThread) {
      try {
        const page = extractMessageListPage(await this.deps.exec.run(OPS.messageList, messageListVars(threadId, null)));
        const present = new Set(page.nodes.map(messageIdOf).filter((id): id is string => !!id));
        const times = page.nodes.map((n) => Number((n as Record<string, unknown>).timestamp_ms)).filter(Number.isFinite);
        const oldestInPage = times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
        for (const c of candidates) if (!present.has(c.messageId) && c.timestamp >= oldestInPage) this.store.remove(threadId, c.messageId);
      } catch {
        // Leave the message in place; a later refresh will settle it.
      }
    }
  }

  /** The page's own thread/message queries (seen by the tap): a second source of truth. */
  applyObservation(o: GraphQLObservation): void {
    const vars = (o.variables && typeof o.variables === 'object' ? o.variables : {}) as Record<string, unknown>;
    if (o.name === OPS.threadList) {
      if (typeof vars.id === 'string') this.store.setViewerFbid(vars.id);
      this.store.ingestThreads(extractThreadListPage(o.data).nodes);
    } else if (o.name === OPS.messageList) {
      this.store.ingestMessages(extractMessageListPage(o.data).nodes, typeof vars.id === 'string' ? { threadId: vars.id } : {});
    }
  }

  /** Fallback refresh used by Sync when the relay feed is unavailable. */
  async refresh(): Promise<void> {
    if (this.deps.engine.state !== 'ready') return;
    await this.fetchInboxPage(null, false);
    const active = this.activeThreadId;
    if (active) {
      const page = extractMessageListPage(await this.deps.exec.run(OPS.messageList, messageListVars(active, null)));
      this.store.ingestMessages(page.nodes, { threadId: active });
    }
  }
}
