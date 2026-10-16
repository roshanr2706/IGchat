import { beforeEach, describe, expect, it } from 'vitest';
import { makeImage, makeText, makeUser } from '../../../shared/test/factories';
import type { Message } from '../../../shared/types';
import { IgError, setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge, type FakeHandlers } from '../lib/fakeBridge';
import { inbox } from './inbox.svelte';
import { messages } from './messages.svelte';
import { ui } from './ui.svelte';

const T = 't1';
let server: Message[];
let bridge: FakeBridge;

function setup(extra: FakeHandlers = {}): void {
  bridge = createFakeBridge({
    'thread:open': () => ({ messages: server.slice(-2), hasOlder: server.length > 2 }),
    'thread:loadOlder': () => ({ messages: server.slice(0, -2), hasOlder: false }),
    'thread:markSeen': () => undefined,
    'msg:sendText': (threadId, text, replyToId) => makeText({ id: `real-${text}`, threadId, senderId: 'me', text, ...(replyToId ? { replyTo: { messageId: replyToId, senderId: 'u', preview: 'p' } } : {}) }),
    'msg:sendImage': (threadId) => makeImage({ id: 'real-img', threadId, senderId: 'me' }),
    'msg:react': (_t, id, emoji) => ({ ...server.find((m) => m.id === id)!, reactions: [{ emoji, userIds: ['me'] }] }),
    'msg:unreact': (_t, id) => ({ ...server.find((m) => m.id === id)!, reactions: [] }),
    'msg:edit': (_t, id, text) => ({ ...(server.find((m) => m.id === id) as Message), text, editedAt: 1 } as Message),
    'msg:unsend': () => undefined,
    ...extra
  });
  setBridge(bridge);
}

beforeEach(() => {
  server = [
    makeText({ id: 'a', threadId: T, senderId: 'u', timestamp: 1 }),
    makeText({ id: 'b', threadId: T, senderId: 'me', timestamp: 2 }),
    makeImage({ id: 'c', threadId: T, senderId: 'u', timestamp: 3 }),
    makeText({ id: 'd', threadId: T, senderId: 'me', timestamp: 4, text: 'original' })
  ];
  messages.byThread = {};
  inbox.me = makeUser({ id: 'me' });
  inbox.activeId = T;
  ui.toasts = [];
  ui.replyTo = null;
  ui.editingId = null;
  setup();
});

const ids = (): string[] => messages.get(T)!.messages.map((m) => m.id);

describe('messages store', () => {
  it('opens a thread and loads older history without duplicates', async () => {
    await messages.open(T);
    expect(ids()).toEqual(['c', 'd']);
    expect(messages.get(T)!.hasOlder).toBe(true);
    await messages.loadOlder(T);
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(messages.get(T)!.hasOlder).toBe(false);
    expect(bridge.calls.some((c) => c.channel === 'thread:markSeen')).toBe(true);
  });

  it('sends text optimistically and swaps in the confirmed message', async () => {
    await messages.open(T);
    const pending = messages.sendText(T, 'hey', null);
    const temp = messages.get(T)!.messages.at(-1)!;
    expect(temp.status).toBe('pending');
    expect(temp.id).toMatch(/^temp-/);
    await pending;
    const real = messages.get(T)!.messages.at(-1)!;
    expect(real.id).toBe('real-hey');
    expect(real.status).toBe('sent');
    expect(real.clientTempId).toBe(temp.id);
  });

  it('includes a reply reference', async () => {
    await messages.open(T);
    await messages.sendText(T, 'yes', server[3]!);
    expect(bridge.calls.find((c) => c.channel === 'msg:sendText')!.args).toEqual([T, 'yes', 'd', expect.stringMatching(/^temp-/)]);
  });

  it('marks failed sends and retries them', async () => {
    let fail = true;
    setup({ 'msg:sendText': (threadId, text) => { if (fail) throw new IgError('Network', 'down'); return makeText({ id: 'real-retry', threadId, senderId: 'me', text }); } });
    await messages.open(T);
    await messages.sendText(T, 'retry me', null);
    const failed = messages.get(T)!.messages.at(-1)!;
    expect(failed.status).toBe('failed');
    fail = false;
    await messages.retry(T, failed.id);
    expect(messages.get(T)!.messages.at(-1)!.id).toBe('real-retry');
  });

  it('discards failed messages', async () => {
    setup({ 'msg:sendText': () => { throw new IgError('Network', 'down'); } });
    await messages.open(T);
    await messages.sendText(T, 'nope', null);
    const failed = messages.get(T)!.messages.at(-1)!;
    messages.discard(T, failed.id);
    expect(ids()).toEqual(['c', 'd']);
  });

  it('sends images optimistically', async () => {
    await messages.open(T);
    await messages.sendImage(T, { bytes: new Uint8Array([1]), mime: 'image/png', previewUrl: 'blob:x' });
    expect(messages.get(T)!.messages.at(-1)!.id).toBe('real-img');
  });

  it('reacts optimistically and reverts on failure', async () => {
    await messages.open(T);
    await messages.react(T, 'c', '🔥');
    expect(messages.find(T, 'c')!.reactions).toEqual([{ emoji: '🔥', userIds: ['me'] }]);
    setup({ 'msg:unreact': () => { throw new IgError('Network', 'down'); } });
    await messages.unreact(T, 'c');
    expect(messages.find(T, 'c')!.reactions).toEqual([{ emoji: '🔥', userIds: ['me'] }]);
    expect(ui.toasts.length).toBe(1);
  });

  it('edits optimistically and reverts with a specific toast when the window expired', async () => {
    await messages.open(T);
    await messages.edit(T, 'd', 'changed');
    const edited = messages.find(T, 'd')!;
    expect(edited.kind === 'text' && edited.text).toBe('changed');
    setup({ 'msg:edit': () => { throw new IgError('EditWindowExpired', 'late'); } });
    await messages.edit(T, 'd', 'again');
    const reverted = messages.find(T, 'd')!;
    expect(reverted.kind === 'text' && reverted.text).toBe('changed');
    expect(ui.toasts.at(-1)!.text).toMatch(/Too late to edit/);
  });

  it('unsends optimistically and restores on failure', async () => {
    await messages.open(T);
    await messages.unsend(T, 'd');
    expect(ids()).toEqual(['c']);
    setup({ 'msg:unsend': () => { throw new IgError('Network', 'down'); } });
    await messages.open(T);
    await messages.unsend(T, 'c');
    expect(ids()).toEqual(['c', 'd']);
    expect(ui.toasts.at(-1)!.text).toBe("Couldn't unsend message");
  });

  it('applies pushed new/updated/removed events and dedupes', async () => {
    await messages.open(T);
    const off = messages.subscribe();
    const incoming = makeText({ id: 'e', threadId: T, senderId: 'u', timestamp: 5 });
    bridge.emit('msg:new', T, [incoming]);
    bridge.emit('msg:new', T, [incoming]);
    expect(ids()).toEqual(['c', 'd', 'e']);
    bridge.emit('msg:updated', T, { ...incoming, text: 'fixed', editedAt: 6 } as Message);
    expect(messages.find(T, 'e')!.editedAt).toBe(6);
    ui.editingId = 'e';
    bridge.emit('msg:removed', T, 'e');
    expect(ids()).toEqual(['c', 'd']);
    expect(ui.editingId).toBeNull();
    off();
  });

  it('marks the first unread message for threads that are not active', async () => {
    await messages.open(T);
    inbox.activeId = 'other';
    messages.onNew(T, [makeText({ id: 'x', threadId: T, timestamp: 9 })]);
    expect(messages.get(T)!.firstUnreadId).toBe('x');
    messages.leave(T);
    expect(messages.get(T)!.firstUnreadId).toBeNull();
  });

  it('lists sent media for the lightbox and details panel', async () => {
    await messages.open(T);
    await messages.loadOlder(T);
    expect(messages.mediaOf(T).map((m) => m.id)).toEqual(['c']);
  });

  it('does not discard a pending message while its send is in flight', async () => {
    await messages.open(T);
    const pending = messages.sendText(T, 'hey', null);
    const temp = messages.get(T)!.messages.at(-1)!;
    messages.discard(T, temp.id);
    await pending;
    expect(messages.get(T)!.messages.at(-1)!.id).toBe('real-hey');
  });

  it('revokes an image preview blob exactly once', async () => {
    const calls: string[] = [];
    const orig = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => { calls.push(u); };
    try {
      await messages.open(T);
      const pending = messages.sendImage(T, { bytes: new Uint8Array([1]), mime: 'image/png', previewUrl: 'blob:x' });
      messages.discard(T, messages.get(T)!.messages.at(-1)!.id);
      await pending;
      expect(calls).toEqual(['blob:x']);
    } finally {
      URL.revokeObjectURL = orig;
    }
  });

  it('does not send react/unreact/edit/unsend for failed messages', async () => {
    setup({ 'msg:sendText': () => { throw new IgError('Network', 'down'); } });
    await messages.open(T);
    await messages.sendText(T, 'x', null);
    const failed = messages.get(T)!.messages.at(-1)!;
    await messages.react(T, failed.id, '🔥');
    await messages.unreact(T, failed.id);
    await messages.edit(T, failed.id, 'y');
    await messages.unsend(T, failed.id);
    const channels = bridge.calls.map((c) => c.channel);
    expect(channels.some((c) => ['msg:react', 'msg:unreact', 'msg:edit', 'msg:unsend'].includes(c))).toBe(false);
    expect(ids()).toEqual(['c', 'd']);
  });

  it('does not act on pending messages', async () => {
    await messages.open(T);
    const pending = messages.sendText(T, 'hey', null);
    const temp = messages.get(T)!.messages.at(-1)!;
    await messages.react(T, temp.id, '🔥');
    await messages.edit(T, temp.id, 'z');
    await messages.unsend(T, temp.id);
    await pending;
    const channels = bridge.calls.map((c) => c.channel);
    expect(channels.some((c) => ['msg:react', 'msg:edit', 'msg:unsend'].includes(c))).toBe(false);
    expect(messages.get(T)!.messages.at(-1)!.id).toBe('real-hey');
  });

  it('clears editingId when the edited message is unsent', async () => {
    await messages.open(T);
    ui.editingId = 'd';
    await messages.unsend(T, 'd');
    expect(ui.editingId).toBeNull();
  });

  it('does not mark own pushed messages as unread', async () => {
    await messages.open(T);
    inbox.activeId = 'other';
    messages.onNew(T, [makeText({ id: 'm1', threadId: T, senderId: 'me', timestamp: 9 })]);
    expect(messages.get(T)!.firstUnreadId).toBeNull();
  });

  it('passes the temp id to main when sending', async () => {
    await messages.open(T);
    await messages.sendText(T, 'hey', null);
    const args = bridge.calls.find((c) => c.channel === 'msg:sendText')!.args;
    expect(args[3]).toMatch(/^temp-/);
  });

  it('replaces the temp message when its echo arrives first', async () => {
    let resolveSend: (m: Message) => void = () => {};
    setup({ 'msg:sendText': () => new Promise<Message>((r) => (resolveSend = r)) });
    await messages.open(T);
    const sending = messages.sendText(T, 'echo me', null);
    const tempId = messages.get(T)!.messages.at(-1)!.id;
    const echo = { ...makeText({ id: 'real-echo', threadId: T, senderId: 'me', text: 'echo me', timestamp: 99 }), clientTempId: tempId };
    messages.onNew(T, [echo]);
    expect(messages.get(T)!.messages.filter((m) => m.kind === 'text' && m.text === 'echo me')).toHaveLength(1);
    expect(messages.get(T)!.messages.at(-1)!.id).toBe('real-echo');
    resolveSend({ ...echo });
    await sending;
    expect(messages.get(T)!.messages.filter((m) => m.id === 'real-echo')).toHaveLength(1);
  });

  it('keeps messages in chronological order when older ones arrive as new', async () => {
    await messages.open(T);
    messages.onNew(T, [makeText({ id: 'old', threadId: T, senderId: 'u', timestamp: 0 })]);
    expect(ids()[0]).toBe('old');
  });

  it('marks the first unread message from the lastSeenMessageId on open', async () => {
    setup({ 'thread:open': () => ({ messages: server, hasOlder: false, lastSeenMessageId: 'b' }) });
    await messages.open(T);
    expect(messages.get(T)!.firstUnreadId).toBe('c');
  });
});
