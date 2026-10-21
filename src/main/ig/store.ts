import type { EventMap } from '../../shared/ipc';
import type { Message, Thread, User } from '../../shared/types';
import { Emitter } from '../emitter';
import { normalizeMessage, normalizeReactions, normalizeThread, normalizeUser, type MessageContext } from './normalize';

type ThreadEntry = { thread: Thread; fbid: string; threadKey: string; viewerWatermark: number };
export type IngestOptions = { silent?: boolean; threadId?: string };
export type RemovalCandidate = { threadId: string; messageId: string; timestamp: number };

const MAX_REMOVED = 2000;
const MAX_ORPHANS = 500;
const MAX_KNOWN_USERS = 500;
const byTime = (a: Message, b: Message): number => a.timestamp - b.timestamp;
const sameContent = (a: Message, b: Message): boolean => JSON.stringify({ ...a, clientTempId: undefined }) === JSON.stringify({ ...b, clientTempId: undefined });
const field = (raw: unknown, key: string): string | undefined => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' && v ? v : undefined;
};

/** What IGchat knows about the account, built from normalized Instagram data. Emits ChatService events on change. */
export class IgStore {
  readonly events = new Emitter<EventMap>();
  viewer: User | null = null;
  viewerFbid: string | null = null;
  private readonly threadsById = new Map<string, ThreadEntry>();
  private readonly threadIdByFbid = new Map<string, string>();
  private readonly igidByFbid = new Map<string, string>();
  private readonly messagesByThread = new Map<string, Map<string, Message>>();
  private readonly itemIndex = new Map<string, { threadId: string; messageId: string }>();
  private readonly itemIdByMessage = new Map<string, string>();
  private orphans: { fbid: string; key: string; raw: unknown; silent: boolean }[] = [];
  private readonly recentlyRemoved = new Set<string>();
  private readonly pendingByOtid = new Map<string, string>();
  private readonly knownUsers = new Map<string, User>();

  setViewer(user: User, fbid: string | null): void {
    this.mergeViewer(user);
    if (fbid) this.viewerFbid = fbid;
    this.reattribute();
  }

  /**
   * Different sources describe the viewer in more or less detail (the live page's record can lack the username,
   * name and photo). Keep the best of each field; a thinner copy never erases what is known.
   */
  private mergeViewer(user: User): void {
    const v = this.viewer;
    if (!v || v.id !== user.id) {
      this.viewer = { ...user };
      return;
    }
    this.viewer = {
      ...v,
      username: user.username || v.username,
      fullName: user.fullName || v.fullName,
      avatarUrl: user.avatarUrl || v.avatarUrl,
      verified: v.verified || user.verified
    };
  }

  setViewerFbid(fbid: string): void {
    if (this.viewerFbid) return;
    this.viewerFbid = fbid;
    this.reattribute();
  }

  /** The Instagram id behind an fbid, once known (the viewer's own, or a participant's). */
  private igidOf(fbid: string): string | undefined {
    if (this.viewer && this.viewerFbid && fbid === this.viewerFbid) return this.viewer.id;
    return this.igidByFbid.get(fbid);
  }

  /**
   * Messages normalized before the viewer (or a participant) was known carry a bare fbid as sender. Rewrite those
   * to the Instagram id the UI compares against, so own messages become editable/unsendable, and tell the renderer.
   */
  private reattribute(): void {
    const fix = (id: string): string => (/^[0-9]{12,}$/.test(id) ? (this.igidOf(id) ?? id) : id);
    for (const [threadId, bucket] of this.messagesByThread) {
      for (const [id, m] of bucket) {
        const senderId = fix(m.senderId);
        const reactions = m.reactions.map((r) => ({ ...r, userIds: [...new Set(r.userIds.map(fix))] }));
        const replyTo = m.replyTo ? { ...m.replyTo, senderId: fix(m.replyTo.senderId) } : undefined;
        const changed =
          senderId !== m.senderId ||
          (replyTo && replyTo.senderId !== m.replyTo!.senderId) ||
          reactions.some((r, i) => r.userIds.join() !== m.reactions[i]!.userIds.join());
        if (!changed) continue;
        const next = { ...m, senderId, reactions, ...(replyTo ? { replyTo } : {}) } as Message;
        bucket.set(id, next);
        this.events.emit('msg:updated', threadId, next);
      }
    }
  }

  clear(): void {
    this.viewer = null;
    this.viewerFbid = null;
    for (const m of [this.threadsById, this.threadIdByFbid, this.igidByFbid, this.messagesByThread, this.itemIndex, this.itemIdByMessage, this.pendingByOtid, this.recentlyRemoved, this.knownUsers]) m.clear();
    this.orphans = [];
  }

  ingestThreads(raws: unknown[], opts: IngestOptions = {}): Thread[] {
    const all: Thread[] = [];
    const changed: Thread[] = [];
    for (const raw of raws) {
      const v = raw && typeof raw === 'object' ? normalizeUser((raw as Record<string, unknown>).viewer)?.user : undefined;
      if (v && (!this.viewer || v.id === this.viewer.id)) this.mergeViewer(v);
    }
    const knownBefore = this.igidByFbid.size;
    const hadViewer = Boolean(this.viewer && this.viewerFbid);
    for (const raw of raws) {
      const n = normalizeThread(raw, this.viewer?.id ?? null);
      if (!n) continue;
      if (n.viewerFbid && !this.viewerFbid) this.viewerFbid = n.viewerFbid;
      for (const u of n.users) if (u.fbid) this.igidByFbid.set(u.fbid, u.user.id);
      this.threadIdByFbid.set(n.fbid, n.thread.id);
      const prev = this.threadsById.get(n.thread.id);
      this.threadsById.set(n.thread.id, {
        thread: n.thread,
        fbid: n.fbid,
        threadKey: n.threadKey || prev?.threadKey || '',
        viewerWatermark: Math.max(n.viewerWatermark, prev?.viewerWatermark ?? 0)
      });
      all.push(n.thread);
      if (!prev || JSON.stringify(prev.thread) !== JSON.stringify(n.thread)) changed.push(n.thread);
    }
    if (changed.length && !opts.silent) this.events.emit('inbox:updated', changed);
    if (this.igidByFbid.size !== knownBefore || (!hadViewer && this.viewer && this.viewerFbid)) this.reattribute();
    this.replayOrphans();
    return all;
  }

  ingestMessages(raws: unknown[], opts: IngestOptions = {}): Message[] {
    const result: Message[] = [];
    const added = new Map<string, Message[]>();
    const addedKeys = new Set<string>();
    for (const raw of raws) {
      const threadFbid = field(raw, 'thread_fbid');
      let threadId = threadFbid ? this.threadIdByFbid.get(threadFbid) : opts.threadId;
      if (!threadId && threadFbid) {
        if (opts.threadId) {
          this.threadIdByFbid.set(threadFbid, opts.threadId);
          threadId = opts.threadId;
        } else {
          // Park until the thread is known; a repeat of the same record replaces the parked copy.
          const key = `${threadFbid}/${field(raw, 'message_id') ?? ''}`;
          this.orphans = this.orphans.filter((o) => o.key !== key);
          this.orphans.push({ fbid: threadFbid, key, raw, silent: !!opts.silent });
          if (this.orphans.length > MAX_ORPHANS) this.orphans.shift();
          continue;
        }
      }
      if (!threadId) continue;
      const rawId = field(raw, 'message_id');
      if (rawId && this.recentlyRemoved.has(`${threadId}/${rawId}`)) continue;
      const bucket = this.bucket(threadId);
      const n = normalizeMessage(raw, this.context(threadId));
      if (!n) {
        if (rawId && field(raw, 'tombstone_reason') && bucket.has(rawId)) this.remove(threadId, rawId, opts.silent);
        continue;
      }
      const prev = bucket.get(n.message.id);
      let message = n.message;
      const temp = !opts.silent && n.otid ? this.pendingByOtid.get(n.otid) : undefined;
      if (temp) {
        message = { ...message, clientTempId: temp };
        this.pendingByOtid.delete(n.otid!);
      } else if (prev?.clientTempId) {
        message = { ...message, clientTempId: prev.clientTempId };
      }
      this.itemIndex.set(n.itemId, { threadId, messageId: message.id });
      this.itemIdByMessage.set(message.id, n.itemId);
      bucket.set(message.id, message);
      result.push(message);
      if (opts.silent) continue;
      const key = `${threadId}/${message.id}`;
      if (addedKeys.has(key)) {
        const list = added.get(threadId)!;
        list[list.findIndex((m) => m.id === message.id)] = message;
      } else if (!prev) {
        addedKeys.add(key);
        added.set(threadId, [...(added.get(threadId) ?? []), message]);
      } else if (!sameContent(prev, message) || prev.clientTempId !== message.clientTempId) {
        this.events.emit('msg:updated', threadId, message);
      }
    }
    for (const [threadId, list] of added) this.events.emit('msg:new', threadId, list.sort(byTime));
    return result;
  }

  /** Replays parked records whose thread is now known, each as loudly as it originally arrived. */
  private replayOrphans(): void {
    if (!this.orphans.length) return;
    const ready = this.orphans.filter((o) => this.threadIdByFbid.has(o.fbid));
    if (!ready.length) return;
    this.orphans = this.orphans.filter((o) => !this.threadIdByFbid.has(o.fbid));
    const loud = ready.filter((o) => !o.silent).map((o) => o.raw);
    const quiet = ready.filter((o) => o.silent).map((o) => o.raw);
    if (quiet.length) this.ingestMessages(quiet, { silent: true });
    if (loud.length) this.ingestMessages(loud);
  }

  upsertOwn(message: Message): void {
    this.bucket(message.threadId).set(message.id, message);
  }

  remove(threadId: string, messageId: string, silent = false): boolean {
    if (!this.messagesByThread.get(threadId)?.delete(messageId)) return false;
    const itemId = this.itemIdByMessage.get(messageId);
    if (itemId) this.itemIndex.delete(itemId);
    this.itemIdByMessage.delete(messageId);
    this.recentlyRemoved.add(`${threadId}/${messageId}`);
    if (this.recentlyRemoved.size > MAX_REMOVED) this.recentlyRemoved.delete(this.recentlyRemoved.values().next().value!);
    if (!silent) this.events.emit('msg:removed', threadId, messageId);
    return true;
  }

  registerPending(otid: string, clientTempId: string): void {
    this.pendingByOtid.set(otid, clientTempId);
  }

  dropPending(otid: string): void {
    this.pendingByOtid.delete(otid);
  }

  /** Whether a send's otid is still waiting for its echo (the echo consumes it). */
  isPending(otid: string): boolean {
    return this.pendingByOtid.has(otid);
  }

  /** The stored message that echoed a send, found by the temp id it was tagged with. */
  findByTempId(threadId: string, clientTempId: string): Message | undefined {
    return this.messagesOf(threadId).find((m) => m.clientTempId === clientTempId);
  }

  /** Tags an already-stored message with the temp id of the send it answers and tells the renderer to swap the temp bubble. */
  tagAndEmit(threadId: string, messageId: string, clientTempId: string): Message | null {
    const m = this.find(threadId, messageId);
    if (!m) return null;
    const tagged = { ...m, clientTempId };
    this.bucket(threadId).set(messageId, tagged);
    this.events.emit('msg:updated', threadId, tagged);
    return tagged;
  }

  /** The thread id for a thread fbid (or id) the store already knows. */
  threadIdOf(fbid: string): string | undefined {
    return this.threadIdByFbid.get(fbid) ?? (this.threadsById.has(fbid) ? fbid : undefined);
  }

  thread(id: string): Thread | undefined {
    return this.threadsById.get(id)?.thread;
  }

  threads(): Thread[] {
    return [...this.threadsById.values()].map((e) => e.thread).sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  threadKey(id: string): string {
    return this.threadsById.get(id)?.threadKey ?? '';
  }

  messagesOf(threadId: string): Message[] {
    return [...(this.messagesByThread.get(threadId)?.values() ?? [])].sort(byTime);
  }

  find(threadId: string, messageId: string): Message | undefined {
    return this.messagesByThread.get(threadId)?.get(messageId);
  }

  itemIdOf(messageId: string): string | undefined {
    return this.itemIdByMessage.get(messageId);
  }

  /** Relay record ids that vanished -> the messages they were (to be verified before removing). */
  candidatesForRemoval(ids: string[]): RemovalCandidate[] {
    const out: RemovalCandidate[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const ref = this.itemIndex.get(id);
      const m = ref ? this.find(ref.threadId, ref.messageId) : undefined;
      if (ref && m && !seen.has(`${ref.threadId}/${m.id}`)) {
        seen.add(`${ref.threadId}/${m.id}`);
        out.push({ threadId: ref.threadId, messageId: ref.messageId, timestamp: m.timestamp });
      }
    }
    return out;
  }

  lastSeenMessageId(threadId: string): string | null {
    const wm = this.threadsById.get(threadId)?.viewerWatermark ?? 0;
    if (!wm) return null;
    return this.messagesOf(threadId).filter((m) => m.timestamp <= wm).at(-1)?.id ?? null;
  }

  applyReactions(threadId: string, messageId: string, raws: unknown[]): Message | null {
    const m = this.find(threadId, messageId);
    if (!m) return null;
    const next = { ...m, reactions: normalizeReactions(raws, this.context(threadId)) };
    this.bucket(threadId).set(messageId, next);
    return next;
  }

  rememberUser(user: User): void {
    this.knownUsers.set(user.id, user);
    if (this.knownUsers.size > MAX_KNOWN_USERS) this.knownUsers.delete(this.knownUsers.keys().next().value!);
  }

  knownUser(id: string): User | undefined {
    return this.knownUsers.get(id) ?? this.threads().flatMap((t) => t.participants).find((p) => p.id === id);
  }

  dmThreadWith(userId: string): Thread | undefined {
    return this.threads().find((t) => !t.isGroup && t.participants.length === 1 && t.participants[0]!.id === userId);
  }

  /**
   * A minimal thread for a DM the page just opened, until the relay delivers the real record. Silent (the caller
   * returns it directly). A later real record with the same id replaces it and is announced as an ordinary change.
   */
  addPlaceholderThread(thread: Thread): void {
    if (this.threadsById.has(thread.id) || this.threadIdByFbid.has(thread.id)) return;
    this.threadsById.set(thread.id, { thread, fbid: thread.id, threadKey: '', viewerWatermark: 0 });
    this.threadIdByFbid.set(thread.id, thread.id);
    this.replayOrphans();
  }

  private bucket(threadId: string): Map<string, Message> {
    let b = this.messagesByThread.get(threadId);
    if (!b) {
      b = new Map();
      this.messagesByThread.set(threadId, b);
    }
    return b;
  }

  private context(threadId: string): MessageContext {
    return { threadId, viewerIgid: this.viewer?.id ?? 'me', viewerFbid: this.viewerFbid, igidForFbid: (fbid) => this.igidByFbid.get(fbid) };
  }
}
