import type { EventMap } from '../../shared/ipc';
import type { Message, Thread, User } from '../../shared/types';
import { Emitter } from '../emitter';
import { normalizeMessage, normalizeReactions, normalizeThread, normalizeUser, type MessageContext } from './normalize';

type ThreadEntry = { thread: Thread; fbid: string; threadKey: string; viewerWatermark: number };
export type IngestOptions = { silent?: boolean; threadId?: string };
export type RemovalCandidate = { threadId: string; messageId: string; timestamp: number };

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
  private readonly pendingByOtid = new Map<string, string>();

  setViewer(user: User, fbid: string | null): void {
    this.viewer = user;
    if (fbid) this.viewerFbid = fbid;
  }

  setViewerFbid(fbid: string): void {
    if (!this.viewerFbid) this.viewerFbid = fbid;
  }

  clear(): void {
    this.viewer = null;
    this.viewerFbid = null;
    for (const m of [this.threadsById, this.threadIdByFbid, this.igidByFbid, this.messagesByThread, this.itemIndex, this.itemIdByMessage, this.pendingByOtid]) m.clear();
  }

  ingestThreads(raws: unknown[], opts: IngestOptions = {}): Thread[] {
    const all: Thread[] = [];
    const changed: Thread[] = [];
    for (const raw of raws) {
      const n = normalizeThread(raw, this.viewer?.id ?? null);
      if (!n) continue;
      if (n.viewerFbid) this.setViewerFbid(n.viewerFbid);
      if (!this.viewer) this.viewer = normalizeUser((raw as Record<string, unknown>).viewer)?.user ?? null;
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
    return all;
  }

  ingestMessages(raws: unknown[], opts: IngestOptions = {}): Message[] {
    const result: Message[] = [];
    const added = new Map<string, Message[]>();
    for (const raw of raws) {
      const threadFbid = field(raw, 'thread_fbid');
      const threadId = (threadFbid ? this.threadIdByFbid.get(threadFbid) : undefined) ?? opts.threadId;
      if (!threadId) continue;
      const bucket = this.bucket(threadId);
      const n = normalizeMessage(raw, this.context(threadId));
      if (!n) {
        const gone = field(raw, 'message_id');
        if (gone && field(raw, 'tombstone_reason') && bucket.has(gone)) this.remove(threadId, gone, opts.silent);
        continue;
      }
      const prev = bucket.get(n.message.id);
      let message = n.message;
      const temp = n.otid ? this.pendingByOtid.get(n.otid) : undefined;
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
      if (!prev) added.set(threadId, [...(added.get(threadId) ?? []), message]);
      else if (!sameContent(prev, message)) this.events.emit('msg:updated', threadId, message);
    }
    for (const [threadId, list] of added) this.events.emit('msg:new', threadId, list.sort(byTime));
    return result;
  }

  upsertOwn(message: Message): void {
    this.bucket(message.threadId).set(message.id, message);
  }

  remove(threadId: string, messageId: string, silent = false): boolean {
    if (!this.messagesByThread.get(threadId)?.delete(messageId)) return false;
    if (!silent) this.events.emit('msg:removed', threadId, messageId);
    return true;
  }

  registerPending(otid: string, clientTempId: string): void {
    this.pendingByOtid.set(otid, clientTempId);
  }

  dropPending(otid: string): void {
    this.pendingByOtid.delete(otid);
  }

  thread(id: string): Thread | undefined {
    return this.threadsById.get(id)?.thread;
  }

  threads(): Thread[] {
    return [...this.threadsById.values()].map((e) => e.thread).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
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
