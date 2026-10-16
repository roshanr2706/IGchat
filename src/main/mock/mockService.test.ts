import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_WINDOW_MS } from '../../shared/types';
import { ServiceError } from '../chatService';
import { MockChatService } from './mockService';

const NOW = new Date(2026, 9, 8, 18, 0).getTime();
let clock = NOW;
let svc: MockChatService;

beforeEach(() => {
  clock = NOW;
  svc = new MockChatService({ now: () => clock, latencyMs: 0, incomingEveryMs: 0 });
});

describe('MockChatService', () => {
  it('pages the inbox newest first', async () => {
    const first = await svc.getInbox();
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    for (let i = 1; i < first.items.length; i++) expect(first.items[i - 1]!.lastActivityAt).toBeGreaterThanOrEqual(first.items[i]!.lastActivityAt);
    const more = await svc.loadMoreInbox();
    expect(more.items).toHaveLength(10);
    expect(more.hasMore).toBe(false);
  });

  it('opens a thread with the latest page and loads older pages without overlap', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const page = await svc.openThread(t.id);
    expect(page.messages).toHaveLength(30);
    expect(page.hasOlder).toBe(true);
    const older = await svc.loadOlder(t.id);
    expect(older.messages).toHaveLength(30);
    expect(older.messages[older.messages.length - 1]!.timestamp).toBeLessThanOrEqual(page.messages[0]!.timestamp);
    const ids = new Set([...page.messages, ...older.messages].map((m) => m.id));
    expect(ids.size).toBe(60);
  });

  it('keeps the paging cursor valid when the oldest served message is unsent', async () => {
    const mk = () => new MockChatService({ now: () => clock, latencyMs: 0, incomingEveryMs: 0 });
    const probe = mk();
    let threadId = '';
    for (const t of (await probe.getInbox()).items) {
      const p = await probe.openThread(t.id);
      if (p.hasOlder && p.messages[0]!.senderId === 'me') {
        threadId = t.id;
        break;
      }
    }
    expect(threadId).not.toBe('');
    const ref = mk();
    await ref.openThread(threadId);
    const expectedPage = await ref.loadOlder(threadId);
    const expected = expectedPage.messages;

    const fresh = mk();
    const page = await fresh.openThread(threadId);
    await fresh.unsendMessage(threadId, page.messages[0]!.id);
    const older = await fresh.loadOlder(threadId);
    expect(older.messages.map((m) => m.id)).toEqual(expected.map((m) => m.id));
    expect(older.hasOlder).toBe(expectedPage.hasOlder);
  });

  it('pages without overlap or gap when a message is appended between openThread and loadOlder', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const page = await svc.openThread(t.id);
    await svc.sendText(t.id, 'appended', null);
    const older = await svc.loadOlder(t.id);
    const firstIds = new Set(page.messages.map((m) => m.id));
    expect(older.messages.some((m) => firstIds.has(m.id))).toBe(false);
    expect(older.messages).toHaveLength(30);
    // no gap: the last older message directly precedes page[0] in the full history
    const ref = new MockChatService({ now: () => clock, latencyMs: 0, incomingEveryMs: 0 });
    const refFirst = await ref.openThread(t.id);
    const refOlder = await ref.loadOlder(t.id);
    expect(older.messages.map((m) => m.id)).toEqual(refOlder.messages.map((m) => m.id));
    expect(older.messages[older.messages.length - 1]!.id).toBe(refOlder.messages[refOlder.messages.length - 1]!.id);
    expect(refFirst.messages[0]!.id).toBe(page.messages[0]!.id);
  });

  it('sends text, updates the inbox and supports replies', async () => {
    const updated = vi.fn();
    svc.on('inbox:updated', updated);
    const t = (await svc.getInbox()).items[1]!;
    const page = await svc.openThread(t.id);
    const target = page.messages[page.messages.length - 1]!;
    const sent = await svc.sendText(t.id, 'hello', target.id);
    expect(sent).toMatchObject({ kind: 'text', text: 'hello', senderId: 'me', status: 'sent', threadId: t.id });
    expect(sent.replyTo?.messageId).toBe(target.id);
    expect(updated).toHaveBeenCalledWith([expect.objectContaining({ id: t.id, lastMessagePreview: 'You: hello', lastActivityAt: NOW })]);
  });

  it('fails sends containing [fail] with a Network error', async () => {
    const t = (await svc.getInbox()).items[0]!;
    await expect(svc.sendText(t.id, 'please [fail]', null)).rejects.toMatchObject({ code: 'Network' });
  });

  it('sends images as data URLs', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const msg = await svc.sendImage(t.id, new Uint8Array([1, 2, 3]), 'image/png');
    expect(msg).toMatchObject({ kind: 'image', url: 'data:image/png;base64,AQID' });
  });

  it('reacts and unreacts as the current user', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const m = (await svc.openThread(t.id)).messages.find((x) => x.reactions.length === 0)!;
    const reacted = await svc.react(t.id, m.id, '🔥');
    expect(reacted.reactions).toEqual([{ emoji: '🔥', userIds: ['me'] }]);
    const cleared = await svc.unreact(t.id, m.id);
    expect(cleared.reactions).toEqual([]);
  });

  it('edits own text within 15 minutes only', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const sent = await svc.sendText(t.id, 'helo', null);
    clock += 60_000;
    const edited = await svc.editMessage(t.id, sent.id, 'hello');
    expect(edited).toMatchObject({ text: 'hello', editedAt: clock });
    clock += EDIT_WINDOW_MS;
    await expect(svc.editMessage(t.id, sent.id, 'late')).rejects.toMatchObject({ code: 'EditWindowExpired' });
  });

  it("refuses to edit or unsend other people's messages", async () => {
    const t = (await svc.getInbox()).items[0]!;
    const theirs = (await svc.openThread(t.id)).messages.find((m) => m.senderId !== 'me' && m.kind === 'text')!;
    await expect(svc.editMessage(t.id, theirs.id, 'x')).rejects.toBeInstanceOf(ServiceError);
    await expect(svc.unsendMessage(t.id, theirs.id)).rejects.toBeInstanceOf(ServiceError);
  });

  it('unsends own messages and refreshes the preview', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const sent = await svc.sendText(t.id, 'oops', null);
    await svc.unsendMessage(t.id, sent.id);
    const page = await svc.openThread(t.id);
    expect(page.messages.some((m) => m.id === sent.id)).toBe(false);
    expect((await svc.getThreadDetails(t.id)).lastMessagePreview).not.toBe('You: oops');
  });

  it('marks threads seen', async () => {
    const t = (await svc.getInbox()).items.find((x) => x.unread)!;
    await svc.markSeen(t.id);
    expect((await svc.getThreadDetails(t.id)).unread).toBe(false);
  });

  it('simulates incoming messages and edits', async () => {
    const onNew = vi.fn();
    const onUpdated = vi.fn();
    svc.on('msg:new', onNew);
    svc.on('msg:updated', onUpdated);
    svc.simulateIncoming('message');
    expect(onNew).toHaveBeenCalledTimes(1);
    const [threadId, msgs] = onNew.mock.calls[0]!;
    expect(msgs[0].senderId).not.toBe('me');
    expect((await svc.getThreadDetails(threadId)).unread).toBe(true);
    svc.simulateIncoming('edit');
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(onUpdated.mock.calls[0]![1].editedAt).toBe(NOW);
  });

  it('returns copies so callers cannot mutate backend state', async () => {
    const t = (await svc.getInbox()).items[0]!;
    t.title = 'hacked';
    expect((await svc.getThreadDetails(t.id)).title).not.toBe('hacked');
  });

  it('throws NotFound for unknown threads', async () => {
    await expect(svc.openThread('nope')).rejects.toMatchObject({ code: 'NotFound' });
  });

  it('echoes the client temp id on sends and reports a ready session', async () => {
    const t = (await svc.getInbox()).items[0]!;
    const sent = await svc.sendText(t.id, 'tagged', null, 'temp-9');
    expect(sent.clientTempId).toBe('temp-9');
    const img = await svc.sendImage(t.id, new Uint8Array([1]), 'image/png', 'temp-10');
    expect(img.clientTempId).toBe('temp-10');
    expect(await svc.authStatus()).toEqual({ loggedIn: true, engine: 'ready' });
    expect(() => svc.setActiveThread(t.id)).not.toThrow();
    expect(() => svc.setFocused(false)).not.toThrow();
  });
  it('searches people and opens their DM', async () => {
    const people = await svc.searchPeople('alex');
    expect(people.map((p) => p.username)).toEqual(['alex_r']);
    const thread = await svc.openThreadWithUser(people[0]!.id);
    expect(thread.participants.map((p) => p.id)).toEqual([people[0]!.id]);
    await expect(svc.openThreadWithUser('nobody')).rejects.toMatchObject({ code: 'NotFound' });
  });
});
