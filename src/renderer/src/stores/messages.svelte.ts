import { messagePreview } from '../../../shared/preview';
import { withReaction, withoutReaction } from '../../../shared/reactions';
import type { MediaMessage, Message, MessageBody, ReplyRef } from '../../../shared/types';
import { call, IgError, on } from '../lib/api';
import { inbox } from './inbox.svelte';
import { ui } from './ui.svelte';

export type ThreadState = { messages: Message[]; hasOlder: boolean; loadingOlder: boolean; loaded: boolean; firstUnreadId: string | null };
export type ImagePayload = { bytes: Uint8Array; mime: string; previewUrl: string };

const revoke = (url: string): void => {
  if (url.startsWith('blob:')) URL.revokeObjectURL?.(url);
};

class MessagesStore {
  byThread = $state<Record<string, ThreadState>>({});
  private tempSeq = 0;
  private readonly imagePayloads = new Map<string, ImagePayload>();

  private get myId(): string {
    return inbox.me?.id ?? 'me';
  }

  get(threadId: string): ThreadState | undefined {
    return this.byThread[threadId];
  }

  find(threadId: string, id: string): Message | undefined {
    return this.byThread[threadId]?.messages.find((m) => m.id === id);
  }

  private ensure(threadId: string): ThreadState {
    if (!this.byThread[threadId]) {
      this.byThread[threadId] = { messages: [], hasOlder: false, loadingOlder: false, loaded: false, firstUnreadId: null };
    }
    // Read back through the $state proxy so later mutations are reactive.
    return this.byThread[threadId]!;
  }

  async open(threadId: string): Promise<void> {
    const st = this.ensure(threadId);
    void call('thread:markSeen', threadId).catch(() => {});
    try {
      const page = await call('thread:open', threadId);
      const unsent = st.messages.filter((m) => m.status !== 'sent');
      st.messages = [...page.messages, ...unsent];
      st.hasOlder = page.hasOlder;
      st.loaded = true;
      if (page.lastSeenMessageId && !st.firstUnreadId) {
        const seenAt = page.messages.findIndex((m) => m.id === page.lastSeenMessageId);
        const next = seenAt >= 0 ? page.messages.slice(seenAt + 1).find((m) => m.senderId !== this.myId) : undefined;
        if (next) st.firstUnreadId = next.id;
      }
    } catch {
      ui.toast("Couldn't load messages");
    }
  }

  leave(threadId: string): void {
    const st = this.byThread[threadId];
    if (st) st.firstUnreadId = null;
  }

  async loadOlder(threadId: string): Promise<void> {
    const st = this.byThread[threadId];
    if (!st || !st.hasOlder || st.loadingOlder) return;
    st.loadingOlder = true;
    try {
      const page = await call('thread:loadOlder', threadId);
      const have = new Set(st.messages.map((m) => m.id));
      st.messages = [...page.messages.filter((m) => !have.has(m.id)), ...st.messages];
      st.hasOlder = page.hasOlder;
    } catch {
      ui.toast("Couldn't load older messages");
    } finally {
      st.loadingOlder = false;
    }
  }

  private insertTemp(threadId: string, body: MessageBody, replyTo?: ReplyRef): string {
    const st = this.ensure(threadId);
    const tempId = `temp-${++this.tempSeq}`;
    const msg = {
      id: tempId,
      clientTempId: tempId,
      threadId,
      senderId: this.myId,
      timestamp: Date.now(),
      reactions: [],
      status: 'pending',
      ...(replyTo ? { replyTo } : {}),
      ...body
    } as Message;
    st.messages.push(msg);
    return tempId;
  }

  private confirm(threadId: string, tempId: string, real: Message): void {
    const st = this.ensure(threadId);
    const index = st.messages.findIndex((m) => m.id === tempId);
    if (index < 0) return;
    if (st.messages.some((m) => m.id === real.id)) {
      // The real message already arrived via a push event.
      st.messages.splice(index, 1);
      return;
    }
    st.messages[index] = { ...real, clientTempId: tempId };
  }

  private fail(threadId: string, tempId: string): void {
    const m = this.find(threadId, tempId);
    if (m) m.status = 'failed';
  }

  private replace(threadId: string, message: Message): void {
    const st = this.byThread[threadId];
    if (!st) return;
    const index = st.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) st.messages[index] = { ...message, clientTempId: st.messages[index]!.clientTempId };
  }

  private async deliverText(threadId: string, tempId: string, text: string, replyToId: string | null): Promise<void> {
    try {
      this.confirm(threadId, tempId, await call('msg:sendText', threadId, text, replyToId, tempId));
    } catch {
      this.fail(threadId, tempId);
    }
  }

  private async deliverImage(threadId: string, tempId: string, payload: ImagePayload): Promise<void> {
    try {
      this.confirm(threadId, tempId, await call('msg:sendImage', threadId, payload.bytes, payload.mime, tempId));
      if (this.imagePayloads.delete(tempId)) revoke(payload.previewUrl);
    } catch {
      this.fail(threadId, tempId);
    }
  }

  async sendText(threadId: string, text: string, replyTo: Message | null): Promise<void> {
    const ref = replyTo ? { messageId: replyTo.id, senderId: replyTo.senderId, preview: messagePreview(replyTo) } : undefined;
    const tempId = this.insertTemp(threadId, { kind: 'text', text }, ref);
    await this.deliverText(threadId, tempId, text, ref?.messageId ?? null);
  }

  async sendImage(threadId: string, payload: ImagePayload): Promise<void> {
    const tempId = this.insertTemp(threadId, { kind: 'image', url: payload.previewUrl, width: 0, height: 0 });
    this.imagePayloads.set(tempId, payload);
    await this.deliverImage(threadId, tempId, payload);
  }

  async retry(threadId: string, tempId: string): Promise<void> {
    const msg = this.find(threadId, tempId);
    if (!msg || msg.status !== 'failed') return;
    msg.status = 'pending';
    if (msg.kind === 'text') {
      await this.deliverText(threadId, tempId, msg.text, msg.replyTo?.messageId ?? null);
    } else if (msg.kind === 'image') {
      const payload = this.imagePayloads.get(tempId);
      if (payload) await this.deliverImage(threadId, tempId, payload);
      else this.discard(threadId, tempId);
    }
  }

  discard(threadId: string, tempId: string): void {
    const st = this.byThread[threadId];
    if (!st) return;
    if (this.find(threadId, tempId)?.status !== 'failed') return;
    st.messages = st.messages.filter((m) => m.id !== tempId);
    const payload = this.imagePayloads.get(tempId);
    if (payload) {
      revoke(payload.previewUrl);
      this.imagePayloads.delete(tempId);
    }
  }

  async react(threadId: string, messageId: string, emoji: string): Promise<void> {
    const m = this.find(threadId, messageId);
    if (!m || m.status !== 'sent') return;
    const before = $state.snapshot(m.reactions);
    m.reactions = withReaction(before, this.myId, emoji);
    try {
      this.replace(threadId, await call('msg:react', threadId, messageId, emoji));
    } catch {
      const cur = this.find(threadId, messageId);
      if (cur) cur.reactions = before;
      ui.toast("Couldn't add reaction");
    }
  }

  async unreact(threadId: string, messageId: string): Promise<void> {
    const m = this.find(threadId, messageId);
    if (!m || m.status !== 'sent') return;
    const before = $state.snapshot(m.reactions);
    m.reactions = withoutReaction(before, this.myId);
    try {
      this.replace(threadId, await call('msg:unreact', threadId, messageId));
    } catch {
      const cur = this.find(threadId, messageId);
      if (cur) cur.reactions = before;
      ui.toast("Couldn't remove reaction");
    }
  }

  async edit(threadId: string, messageId: string, text: string): Promise<void> {
    const m = this.find(threadId, messageId);
    if (!m || m.kind !== 'text' || m.status !== 'sent') return;
    const before = $state.snapshot(m) as Message;
    m.text = text;
    m.editedAt = Date.now();
    try {
      this.replace(threadId, await call('msg:edit', threadId, messageId, text));
    } catch (err) {
      this.replace(threadId, before);
      ui.toast(
        err instanceof IgError && err.code === 'EditWindowExpired'
          ? 'Too late to edit — Instagram only allows edits for 15 minutes'
          : "Couldn't edit message"
      );
    }
  }

  async unsend(threadId: string, messageId: string): Promise<void> {
    const st = this.byThread[threadId];
    if (!st) return;
    const index = st.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const status = st.messages[index]!.status;
    if (status === 'failed') {
      this.discard(threadId, messageId);
      return;
    }
    if (status !== 'sent') return;
    const removed = $state.snapshot(st.messages[index]!) as Message;
    st.messages.splice(index, 1);
    if (ui.replyTo?.id === messageId) ui.replyTo = null;
    if (ui.editingId === messageId) ui.editingId = null;
    try {
      await call('msg:unsend', threadId, messageId);
    } catch {
      if (!st.messages.some((m) => m.id === removed.id)) st.messages.splice(Math.min(index, st.messages.length), 0, removed);
      ui.toast("Couldn't unsend message");
    }
  }

  onNew(threadId: string, incoming: Message[]): void {
    const st = this.byThread[threadId];
    if (!st?.loaded) return;
    const fresh: Message[] = [];
    for (const m of incoming) {
      // An echo of our own optimistic send: swap the temp bubble for the real message, keeping its key.
      const tempIndex = m.clientTempId ? st.messages.findIndex((x) => x.id === m.clientTempId) : -1;
      if (tempIndex >= 0) {
        st.messages[tempIndex] = { ...m };
        continue;
      }
      if (!st.messages.some((x) => x.id === m.id)) fresh.push(m);
    }
    if (!fresh.length) return;
    // Older messages can arrive as "new" (e.g. the page loading history), so keep chronological order.
    st.messages = [...st.messages, ...fresh].sort((a, b) => a.timestamp - b.timestamp);
    if (threadId !== inbox.activeId && !st.firstUnreadId) {
      const firstOther = fresh.find((m) => m.senderId !== this.myId);
      if (firstOther) st.firstUnreadId = firstOther.id;
    }
  }

  onUpdated(threadId: string, message: Message): void {
    this.replace(threadId, message);
  }

  onRemoved(threadId: string, messageId: string): void {
    const st = this.byThread[threadId];
    if (st) st.messages = st.messages.filter((m) => m.id !== messageId);
    if (ui.editingId === messageId) ui.editingId = null;
    if (ui.replyTo?.id === messageId) ui.replyTo = null;
  }

  mediaOf(threadId: string): MediaMessage[] {
    return (this.byThread[threadId]?.messages ?? []).filter(
      (m): m is MediaMessage => (m.kind === 'image' || m.kind === 'video') && m.status === 'sent'
    );
  }

  subscribe(): () => void {
    const offs = [
      on('msg:new', (threadId, msgs) => this.onNew(threadId, msgs)),
      on('msg:updated', (threadId, msg) => this.onUpdated(threadId, msg)),
      on('msg:removed', (threadId, id) => this.onRemoved(threadId, id))
    ];
    return () => offs.forEach((off) => off());
  }
}

export const messages = new MessagesStore();
