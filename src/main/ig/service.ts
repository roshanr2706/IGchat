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
  editVars, extractEditResult, extractMessageListPage, extractReactions, extractSearchUsers, extractSendResult, extractThreadListPage, extractUnsendResult,
  generateOtid, messageListVars, OPS, reactVars, searchVars, sendTextVars, threadListVars, unsendVars
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
  /** Writes any debounced save now (on quit). */
  flush?(): void;
}

export type IgServiceDeps = {
  engine: EngineLike;
  relay: RelayLike;
  exec: ExecLike;
  store: IgStore;
  cache?: CacheLike;
  tmpDir: string;
  /** Asks the page for an operation's doc id it has not used yet (loads the page's own module). True if found. */
  resolveDocId?: (name: string) => Promise<boolean>;
  /** Extra per-account cleanup after logout (e.g. wiping cached media). */
  onLogout?: () => Promise<void> | void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeouts?: Partial<{ ready: number; openThread: number; imageEcho: number; sendEcho: number; maybeGrace: number; attach: number; attachHold: number }>;
};

const TIMEOUTS = { ready: 20_000, openThread: 4_000, imageEcho: 30_000, sendEcho: 20_000, maybeGrace: 120_000, attach: 30_000, attachHold: 180_000 };
/** An echo may carry a timestamp slightly before our clock says the send started. */
const ECHO_SKEW_MS = 5_000;
const MAX_TRACKED = 200;
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const POLL_MS = 100;
const MAX_SEARCH_CHARS = 100;

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
  private imageBusy = 0;
  private started = false;
  private pagedPast = false;
  private readonly otidByTemp = new Map<string, { otid: string; threadId: string }>();
  private readonly imageWatchers = new Map<string, Set<() => void>>();
  private readonly claimedImages = new Set<string>();
  private readonly deferred = new Set<() => void>();
  private readonly searches = new Map<string, Promise<User[]>>();
  /** Bumped by every explicit thread selection; a slower person-open must not override a newer choice. */
  private selectSeq = 0;

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
    if (this.started) return;
    this.started = true;
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
    this.started = false;
    this.flushDeferred();
    this.offs.forEach((off) => off());
    this.offs = [];
    this.deps.cache?.flush?.();
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

  /** Runs fn after ms (or earlier via the returned finish function, or when the service stops or logs out). */
  private defer(ms: number, fn: () => void): () => void {
    const finish = (): void => {
      clearTimeout(timer);
      if (this.deferred.delete(finish)) fn();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    this.deferred.add(finish);
    return finish;
  }

  private flushDeferred(): void {
    for (const finish of [...this.deferred]) finish();
  }

  private remember<V>(map: Map<string, V>, key: string, value: V): void {
    map.set(key, value);
    if (map.size > MAX_TRACKED) map.delete(map.keys().next().value!);
  }

  private navigate(threadId: string): void {
    // While an image is being handed to the page, the page must stay on that thread.
    if (this.imageBusy > 0 || this.deps.engine.state !== 'ready') return;
    void this.deps.engine.navigateToThread(threadId).catch(() => {});
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
    this.pagedPast = false;
    return true;
  }

  private async fetchInboxPage(cursor: string | null, silent: boolean, keepCursor = false): Promise<Thread[]> {
    const fbid = this.store.viewerFbid;
    if (!fbid) throw new ServiceError('EngineNotReady', 'Instagram is still loading');
    const page = extractThreadListPage(await this.deps.exec.run(OPS.threadList, threadListVars(fbid, cursor)));
    const threads = this.store.ingestThreads(page.nodes, { silent });
    if (!keepCursor) {
      this.inboxCursor = page.endCursor;
      this.inboxHasMore = page.hasMore;
    }
    return threads;
  }

  async me(): Promise<User> {
    if (this.store.viewer?.username) return this.store.viewer;
    await this.ready();
    await this.loadSnapshot();
    // The live page's viewer record can lack the username, name and photo; the inbox query carries them.
    if (!this.store.viewer?.username && this.store.viewerFbid) await this.fetchInboxPage(null, true, true).catch(() => {});
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
    this.pagedPast = true;
    const items = await this.fetchInboxPage(this.inboxCursor, true);
    return { items, hasMore: this.inboxHasMore };
  }

  async openThread(threadId: string): Promise<ThreadPage> {
    this.selectSeq++;
    this.activeThreadId = threadId;
    await this.ready();
    // Navigation is best effort: if the page can't open the thread, the query fallback below still serves it.
    this.navigate(threadId);
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

  async searchPeople(query: string): Promise<User[]> {
    const text = query.trim().slice(0, MAX_SEARCH_CHARS);
    if (!text) return [];
    // Identical searches in flight share one request; search is read-only, so any failure is just an error.
    const running = this.searches.get(text);
    if (running) return running;
    const p = this.runSearch(text).finally(() => {
      if (this.searches.get(text) === p) this.searches.delete(text);
    });
    this.searches.set(text, p);
    return p;
  }

  private async runSearch(text: string): Promise<User[]> {
    await this.ready();
    const unknownOp = (err: unknown): boolean => err instanceof ServiceError && err.code === 'EngineNotReady' && /^Unknown Instagram operation/.test(err.message);
    let data: unknown;
    try {
      data = await this.deps.exec.run(OPS.search, searchVars(text));
    } catch (err) {
      // exec reports an operation whose doc id was never seen or scraped. The search UI's module is loaded lazily by
      // Instagram, so ask the page for it once (as opening its "new message" dialog would) and try again.
      if (!unknownOp(err)) throw err;
      if (!(await this.deps.resolveDocId?.(OPS.search).catch(() => false))) throw new ServiceError('EngineNotReady', "People search isn't available yet");
      try {
        data = await this.deps.exec.run(OPS.search, searchVars(text));
      } catch (again) {
        if (unknownOp(again)) throw new ServiceError('EngineNotReady', "People search isn't available yet");
        throw again;
      }
    }
    const users = extractSearchUsers(data)
      .map((raw) => normalizeUser(raw)?.user)
      .filter((u): u is User => !!u && !!u.username);
    users.forEach((u) => this.store.rememberUser(u));
    return users;
  }

  async openThreadWithUser(userId: string): Promise<Thread> {
    const existing = this.store.dmThreadWith(userId);
    if (existing) return existing;
    const user = this.store.knownUser(userId);
    if (!user) throw new ServiceError('NotFound', 'Search for this person first');
    await this.ready();
    // The page must not be moved while an image is being handed to it.
    if (this.imageBusy > 0) throw new ServiceError('EngineNotReady', 'Instagram is busy right now, try again in a moment');
    // Held like an image send: later image sends queue behind this navigation and background navigation stays off.
    this.imageBusy++;
    const token = ++this.selectSeq;
    const run = this.imageQueue.then(() => this.openUserThreadNow(user, token));
    this.imageQueue = run
      .then(() => {}, () => {})
      .then(() => {
        if (--this.imageBusy === 0 && this.activeThreadId) this.navigate(this.activeThreadId);
      });
    return run;
  }

  private async openUserThreadNow(user: User, token: number): Promise<Thread> {
    const known = this.store.dmThreadWith(user.id);
    if (known) return known;
    await this.ready();
    if (!this.deps.engine.canOpenUserThread()) throw new ServiceError('RateLimited', 'Too many chats opened by name. Try again in a few minutes');
    const threadId = await this.deps.engine.openUserThread(user.username);
    if (!threadId) throw new ServiceError('Unknown', `Couldn't open a chat with @${user.username}`);
    // The relay may deliver the real record under the id the page used or one we can match by person.
    const arrived = (): Thread | undefined => this.store.thread(threadId) ?? this.store.dmThreadWith(user.id);
    await this.waitFor(() => !!arrived(), this.timeout('openThread'));
    if (!arrived()) {
      this.store.addPlaceholderThread({
        id: threadId,
        title: user.fullName || user.username,
        isGroup: false,
        participants: [user],
        adminIds: [],
        lastActivityAt: this.now(),
        lastMessagePreview: '',
        unread: false,
        muted: false,
        avatarUrls: user.avatarUrl ? [user.avatarUrl] : []
      });
    }
    const thread = arrived();
    if (!thread) throw new ServiceError('Unknown', `Couldn't open a chat with @${user.username}`);
    // Only claim the active thread if the user hasn't picked something else in the meantime.
    if (token === this.selectSeq) this.activeThreadId = thread.id;
    return thread;
  }

  async sendText(threadId: string, text: string, replyToId: string | null, clientTempId?: string): Promise<Message> {
    await this.ready();
    // A retry of the same temp id reuses its otid so Instagram can dedupe a send that did go through.
    // Only within the same thread: a temp id seen for another thread never lends its otid.
    const prior = clientTempId ? this.otidByTemp.get(clientTempId) : undefined;
    const known = prior && prior.threadId === threadId ? prior.otid : undefined;
    const otid = known ?? generateOtid(this.now());
    if (clientTempId && !known) this.remember(this.otidByTemp, clientTempId, { otid, threadId });
    if (clientTempId) this.store.registerPending(otid, clientTempId);
    let res: ReturnType<typeof extractSendResult> = null;
    try {
      res = extractSendResult(await this.deps.exec.run(OPS.sendText, sendTextVars(threadId, text, otid, replyToId)));
    } catch (err) {
      if (err instanceof ServiceError && !err.ambiguous) {
        this.store.dropPending(otid);
        throw err;
      }
    }
    // No confirmation (an ambiguous failure, or a 2xx without a message id): the message may have gone out.
    if (!res) return this.settleUncertainText(threadId, otid, clientTempId);
    if (clientTempId) this.otidByTemp.delete(clientTempId);
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

  /** The send may have reached Instagram: look for its echo, and if none comes, report MaybeSent (never a retryable error). */
  private async settleUncertainText(threadId: string, otid: string, clientTempId?: string): Promise<Message> {
    if (!clientTempId) {
      this.store.dropPending(otid);
      throw new ServiceError('MaybeSent', 'Instagram did not confirm the message. It may have been sent');
    }
    await this.waitFor(() => !this.store.isPending(otid), this.timeout('sendEcho'));
    const echoed = this.store.isPending(otid) ? undefined : this.store.findByTempId(threadId, clientTempId);
    if (echoed) {
      this.otidByTemp.delete(clientTempId);
      return echoed;
    }
    // Keep the otid pending for a while so a late echo is still tagged and swaps the temp bubble.
    this.defer(this.timeout('maybeGrace'), () => {
      this.store.dropPending(otid);
      this.otidByTemp.delete(clientTempId);
    });
    throw new ServiceError('MaybeSent', 'Instagram did not confirm the message. It may have been sent');
  }

  sendImage(threadId: string, bytes: Uint8Array, mime: string, clientTempId?: string): Promise<Message> {
    const ext = IMAGE_EXT[mime];
    if (!ext) return Promise.reject(new ServiceError('Unknown', 'Only PNG, JPEG, GIF and WebP images can be sent'));
    // One image at a time: each send must be able to tell which echo is its own.
    this.imageBusy++;
    // The caller gets its answer as soon as it is known, but the queue (and navigation) stay held until the
    // attach call itself has settled, so a slow attach can never overlap the next image or a page navigation.
    const hold = { settled: Promise.resolve() };
    const run = this.imageQueue.then(() => this.sendImageNow(threadId, bytes, ext, hold, clientTempId));
    this.imageQueue = run
      .then(() => {}, () => {})
      .then(() => hold.settled)
      .then(() => {
        if (--this.imageBusy === 0 && this.activeThreadId) this.navigate(this.activeThreadId);
      });
    return run;
  }

  private async sendImageNow(threadId: string, bytes: Uint8Array, ext: string, hold: { settled: Promise<void> }, clientTempId?: string): Promise<Message> {
    await this.ready();
    // An earlier send in this thread that ended MaybeSent must not claim this image's echo.
    for (const finish of [...(this.imageWatchers.get(threadId) ?? [])]) finish();
    const file = join(this.deps.tmpDir, `igchat-upload-${this.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
    await writeFile(file, bytes);
    const startedAt = this.now();
    const before = new Set(this.store.messagesOf(threadId).map((m) => m.id));
    const isMine = (m: Message): boolean =>
      !before.has(m.id) && !this.claimedImages.has(m.id) && m.senderId === this.viewerId && m.kind === 'image' && m.timestamp >= startedAt - ECHO_SKEW_MS;
    const claim = (m: Message): Message => {
      this.claimedImages.add(m.id);
      if (this.claimedImages.size > MAX_TRACKED) this.claimedImages.delete(this.claimedImages.values().next().value!);
      // Tagging through the store tells the renderer to swap the temp bubble in place.
      return clientTempId ? (this.store.tagAndEmit(threadId, m.id, clientTempId) ?? m) : m;
    };
    try {
      // attachImage throws only before the file is handed to the page (safe to report, definite failure). Once it
      // resolves, or the deadline passes with the outcome unknown, only the echo decides, and a missing echo is MaybeSent.
      const attach = this.deps.engine.attachImage(threadId, file);
      // Bounded: if the engine never answers, releasing the queue after a few minutes is the lesser risk.
      let holdTimer: ReturnType<typeof setTimeout> | undefined;
      hold.settled = Promise.race([
        attach.then(() => {}, () => {}),
        new Promise<void>((resolve) => {
          holdTimer = setTimeout(resolve, this.timeout('attachHold'));
          (holdTimer as { unref?: () => void }).unref?.();
        })
      ]).finally(() => clearTimeout(holdTimer));
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([attach, new Promise<void>((resolve) => (deadline = setTimeout(resolve, this.timeout('attach'))))]);
      } finally {
        clearTimeout(deadline);
      }
      await this.waitFor(() => this.store.messagesOf(threadId).some(isMine), this.timeout('imageEcho'));
      const sent = this.store.messagesOf(threadId).filter(isMine).at(-1);
      if (sent) return claim(sent);
      // Keep watching: a late echo is tagged so the renderer swaps the "not confirmed" bubble for it.
      let off = (): void => {};
      const watchers = this.imageWatchers.get(threadId) ?? new Set<() => void>();
      this.imageWatchers.set(threadId, watchers);
      const finish = this.defer(this.timeout('maybeGrace'), () => {
        off();
        watchers.delete(finish);
        if (!watchers.size && this.imageWatchers.get(threadId) === watchers) this.imageWatchers.delete(threadId);
      });
      watchers.add(finish);
      off = this.store.events.on('msg:new', (tid, msgs) => {
        const late = tid === threadId ? msgs.find(isMine) : undefined;
        if (late) {
          claim(late);
          finish();
        }
      });
      throw new ServiceError('MaybeSent', 'Instagram did not confirm the image. It may have been sent');
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

  async unreact(threadId: string, messageId: string): Promise<Message> {
    const m = this.store.find(threadId, messageId);
    if (!m) throw new ServiceError('NotFound', 'Message not found');
    const mine = m.reactions.find((r) => r.userIds.includes(this.viewerId))?.emoji;
    if (!mine) return m; // nothing of ours to remove: send no request
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
    this.selectSeq++;
    this.activeThreadId = threadId;
    if (threadId) this.navigate(threadId);
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
    this.flushDeferred();
    this.hasOlder.clear();
    this.otidByTemp.clear();
    this.claimedImages.clear();
    this.activeThreadId = null;
    this.pagedPast = false;
    this.inboxCursor = null;
    this.inboxHasMore = false;
    await Promise.resolve(this.deps.onLogout?.()).catch(() => {});
    this.emitStatus();
  }

  /** Live changes pushed by the relay bridge. */
  async applyDelta(delta: RelayDelta): Promise<void> {
    this.store.ingestThreads(delta.threads);
    this.store.ingestMessages(delta.messages);
    const candidates = [...this.store.candidatesForRemoval(delta.removed), ...this.droppedFromThreadLists(delta.threads)];
    if (candidates.length) await this.verifyRemovals(candidates);
  }

  /**
   * Instagram removes an unsent message from the thread's message list but may keep its record around, so the bridge
   * never reports it as removed. Any stored message inside the time span a thread delta lists, but missing from it,
   * is a removal candidate (still verified against Instagram before anything is removed).
   */
  private droppedFromThreadLists(threads: unknown[]): { threadId: string; messageId: string; timestamp: number }[] {
    const out: { threadId: string; messageId: string; timestamp: number }[] = [];
    for (const raw of threads) {
      const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      const conn = r?.slide_messages && typeof r.slide_messages === 'object' ? (r.slide_messages as Record<string, unknown>) : null;
      if (!r || !conn || !Array.isArray(conn.edges)) continue;
      const nodes = conn.edges.map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>).node : undefined));
      const listed = new Set(nodes.map(messageIdOf).filter((id): id is string => !!id));
      const times = nodes.map((n) => Number((n as Record<string, unknown> | undefined)?.timestamp_ms)).filter(Number.isFinite);
      if (listed.size < 2 || times.length < 2) continue;
      const fbid = typeof r.thread_fbid === 'string' ? r.thread_fbid : typeof r.id === 'string' ? r.id : undefined;
      const threadId = fbid ? this.store.threadIdOf(fbid) : undefined;
      if (!threadId) continue;
      const lo = Math.min(...times);
      const hi = Math.max(...times);
      for (const m of this.store.messagesOf(threadId)) {
        if (m.status === 'sent' && m.timestamp > lo && m.timestamp < hi && !listed.has(m.id)) out.push({ threadId, messageId: m.id, timestamp: m.timestamp });
      }
    }
    return out;
  }

  /** A record vanishing from the page's store can mean an unsend or just cache cleanup; confirm before removing. */
  private async verifyRemovals(found: { threadId: string; messageId: string; timestamp: number }[]): Promise<void> {
    const byThread = new Map<string, { messageId: string; timestamp: number }[]>();
    const seen = new Set<string>();
    for (const c of found) {
      const key = c.threadId + '/' + c.messageId;
      if (seen.has(key)) continue;
      seen.add(key);
      byThread.set(c.threadId, [...(byThread.get(c.threadId) ?? []), c]);
    }
    for (const [threadId, candidates] of byThread) {
      try {
        const page = extractMessageListPage(await this.deps.exec.run(OPS.messageList, messageListVars(threadId, null)));
        const present = new Set(page.nodes.map(messageIdOf).filter((id): id is string => !!id));
        const times = page.nodes.map((n) => Number((n as Record<string, unknown>).timestamp_ms)).filter(Number.isFinite);
        const oldestInPage = times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
        for (const c of candidates) if (!present.has(c.messageId) && c.timestamp > oldestInPage) this.store.remove(threadId, c.messageId);
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
    await this.fetchInboxPage(null, false, this.pagedPast);
    const active = this.activeThreadId;
    if (active) {
      const page = extractMessageListPage(await this.deps.exec.run(OPS.messageList, messageListVars(active, null)));
      this.store.ingestMessages(page.nodes, { threadId: active });
    }
  }
}
