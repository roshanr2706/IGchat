import { beforeEach, describe, expect, it, vi } from 'vitest';
import threadList from './__fixtures__/threadList.json';
import messageList from './__fixtures__/messageList.json';
import { IgStore } from './store';

const threadNodes = threadList.data.fetch__SlideMailbox.threads_by_folder.edges.map((e) => e.node.as_ig_direct_thread);
const messageNodes = messageList.data.fetch__SlideThread.as_ig_direct_thread.slide_messages.edges.map((e) => e.node);
const node = (id: string) => messageNodes.find((n) => n.message_id === id)!;
const T1 = '1000000000000001';

let store: IgStore;
beforeEach(() => {
  store = new IgStore();
});

describe('IgStore threads', () => {
  it('ingests threads, learns the viewer and both thread ids, and emits only real changes', () => {
    const updates = vi.fn();
    store.events.on('inbox:updated', updates);
    expect(store.ingestThreads(threadNodes)).toHaveLength(2);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates.mock.calls[0]![0]).toHaveLength(2);
    expect(store.threads().map((t) => t.id)).toEqual([T1, '1000000000000002']);
    expect(store.viewerFbid).toBe('900000000000001');
    expect(store.viewer?.id).toBe('9000000001');
    expect(store.threadKey(T1)).toBe('340282366841710300949128000000000000001');
    store.ingestThreads(threadNodes);
    expect(updates).toHaveBeenCalledTimes(1);
    store.ingestThreads([{ ...threadNodes[0], thread_title: 'Renamed' }], { silent: true });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(store.thread(T1)?.title).toBe('Renamed');
  });
});

describe('IgStore messages', () => {
  beforeEach(() => {
    store.ingestThreads(threadNodes, { silent: true });
  });

  it('groups new messages per thread in time order and maps senders', () => {
    const news = vi.fn();
    store.events.on('msg:new', news);
    const out = store.ingestMessages([...messageNodes].reverse());
    expect(out).toHaveLength(10);
    expect(news).toHaveBeenCalledTimes(1);
    const [threadId, list] = news.mock.calls[0]!;
    expect(threadId).toBe(T1);
    expect(list.map((m: { id: string }) => m.id)[0]).toBe('mid.$m1');
    expect(store.find(T1, 'mid.$m2')?.senderId).toBe('9000000002');
    expect(store.messagesOf(T1).map((m) => m.timestamp)).toEqual([...store.messagesOf(T1).map((m) => m.timestamp)].sort((a, b) => a - b));
  });

  it('is silent when asked, and emits updates only for real changes', () => {
    const news = vi.fn();
    const updates = vi.fn();
    store.events.on('msg:new', news);
    store.events.on('msg:updated', updates);
    store.ingestMessages([node('mid.$m2')], { silent: true });
    store.ingestMessages([node('mid.$m2')]);
    expect(news).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
    store.ingestMessages([{ ...node('mid.$m2'), reactions: [{ reaction: '😂', sender_fbid: '900000000000001' }] }]);
    expect(updates).toHaveBeenCalledWith(T1, expect.objectContaining({ id: 'mid.$m2', reactions: [{ emoji: '😂', userIds: ['9000000001'] }] }));
  });

  it('tags the echo of our own send with its clientTempId and keeps it on later updates', () => {
    const news = vi.fn();
    const updates = vi.fn();
    store.events.on('msg:new', news);
    store.events.on('msg:updated', updates);
    store.registerPending('7300000000000000001', 'temp-7');
    store.ingestMessages([node('mid.$m1')]);
    expect(news.mock.calls[0]![1]).toEqual([expect.objectContaining({ id: 'mid.$m1', clientTempId: 'temp-7' })]);
    store.ingestMessages([{ ...node('mid.$m1'), reactions: [] }]);
    expect(updates.mock.calls[0]![1]).toMatchObject({ id: 'mid.$m1', clientTempId: 'temp-7', reactions: [] });
  });

  it('skips messages for unknown threads unless a thread id is given', () => {
    const fresh = new IgStore();
    expect(fresh.ingestMessages([node('mid.$m1')])).toHaveLength(0);
    expect(fresh.ingestMessages([{ ...node('mid.$m1'), thread_fbid: undefined }], { threadId: 'x' })).toHaveLength(1);
  });

  it('removes known messages that come back tombstoned', () => {
    const removed = vi.fn();
    store.events.on('msg:removed', removed);
    store.ingestMessages([node('mid.$m1')], { silent: true });
    store.ingestMessages([{ ...node('mid.$m1'), tombstone_reason: 'UNSENT' }]);
    expect(removed).toHaveBeenCalledWith(T1, 'mid.$m1');
    expect(store.find(T1, 'mid.$m1')).toBeUndefined();
  });

  it('exposes item ids, removal candidates, read position and reactions', () => {
    store.ingestMessages(messageNodes, { silent: true });
    expect(store.itemIdOf('mid.$m1')).toBe('item-1');
    expect(store.candidatesForRemoval(['item-2', 'unknown'])).toEqual([{ threadId: T1, messageId: 'mid.$m2', timestamp: 1792090100000 }]);
    expect(store.lastSeenMessageId(T1)).toBe('mid.$m11');
    expect(store.applyReactions(T1, 'mid.$m3', [{ reaction: '🔥', sender_fbid: '900000000000001' }])?.reactions).toEqual([{ emoji: '🔥', userIds: ['9000000001'] }]);
    const removed = vi.fn();
    store.events.on('msg:removed', removed);
    expect(store.remove(T1, 'mid.$m3')).toBe(true);
    expect(removed).toHaveBeenCalledWith(T1, 'mid.$m3');
    expect(store.remove(T1, 'mid.$m3')).toBe(false);
    store.clear();
    expect(store.threads()).toEqual([]);
    expect(store.viewer).toBeNull();
  });

  it('collapses a duplicate in one batch into one msg:new with the newer content', () => {
    const news = vi.fn();
    const updates = vi.fn();
    store.events.on('msg:new', news);
    store.events.on('msg:updated', updates);
    store.ingestMessages([node('mid.$m1'), { ...node('mid.$m1'), reactions: [{ reaction: '🔥', sender_fbid: '900000000000001' }] }]);
    expect(news).toHaveBeenCalledTimes(1);
    expect(news.mock.calls[0]![1]).toHaveLength(1);
    expect(news.mock.calls[0]![1][0].reactions).toEqual([{ emoji: '🔥', userIds: ['9000000001'] }]);
    expect(updates).not.toHaveBeenCalled();
  });

  it('emits msg:removed once for duplicate tombstones and remove() afterwards, and ignores stale resurrection', () => {
    const removed = vi.fn();
    store.events.on('msg:removed', removed);
    store.ingestMessages([node('mid.$m1')], { silent: true });
    const dead = { ...node('mid.$m1'), tombstone_reason: 'UNSENT' };
    store.ingestMessages([dead, dead]);
    expect(store.remove(T1, 'mid.$m1')).toBe(false);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(store.itemIdOf('mid.$m1')).toBeUndefined();
    store.ingestMessages([node('mid.$m1')]);
    expect(store.find(T1, 'mid.$m1')).toBeUndefined();
  });

  it('keeps the otid mapping through a silent ingest and tags on the later non-silent echo', () => {
    const updates = vi.fn();
    store.events.on('msg:updated', updates);
    store.registerPending('7300000000000000001', 'temp-7');
    store.ingestMessages([node('mid.$m1')], { silent: true });
    expect(store.find(T1, 'mid.$m1')?.clientTempId).toBeUndefined();
    store.ingestMessages([node('mid.$m1')]);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates.mock.calls[0]![1]).toMatchObject({ id: 'mid.$m1', clientTempId: 'temp-7' });
  });

  it('does not emit a duplicate msg:new when an upsertOwn message is later echoed', () => {
    const own = store.ingestMessages([node('mid.$m1')], { silent: true })[0]!;
    const fresh = new IgStore();
    fresh.ingestThreads(threadNodes, { silent: true });
    const news = vi.fn();
    fresh.events.on('msg:new', news);
    fresh.upsertOwn({ ...own, clientTempId: 'temp-1' });
    fresh.ingestMessages([node('mid.$m1')]);
    expect(news).not.toHaveBeenCalled();
    expect(fresh.find(T1, 'mid.$m1')?.clientTempId).toBe('temp-1');
  });

  it('files a record under the thread its fbid maps to, not opts.threadId', () => {
    store.ingestMessages([node('mid.$m1')], { threadId: '1000000000000002' });
    expect(store.find(T1, 'mid.$m1')).toBeDefined();
    expect(store.find('1000000000000002', 'mid.$m1')).toBeUndefined();
  });

  it('accepts an unmapped fbid into opts.threadId and learns the mapping', () => {
    const fresh = new IgStore();
    expect(fresh.ingestMessages([node('mid.$m1')], { threadId: 'X' })).toHaveLength(1);
    expect(fresh.find('X', 'mid.$m1')).toBeDefined();
    fresh.ingestMessages([node('mid.$m2')]);
    expect(fresh.find('X', 'mid.$m2')).toBeDefined();
  });

  it('skips records with neither a thread fbid nor a threadId', () => {
    expect(store.ingestMessages([{ ...node('mid.$m1'), thread_fbid: undefined }])).toHaveLength(0);
  });

  it('parks orphan records and replays them when the thread arrives', () => {
    const fresh = new IgStore();
    const news = vi.fn();
    fresh.events.on('msg:new', news);
    expect(fresh.ingestMessages([node('mid.$m1')])).toHaveLength(0);
    fresh.ingestThreads(threadNodes);
    expect(news).toHaveBeenCalledTimes(1);
    expect(news.mock.calls[0]![0]).toBe(T1);
    expect(fresh.find(T1, 'mid.$m1')).toBeDefined();
    fresh.ingestThreads(threadNodes);
    expect(news).toHaveBeenCalledTimes(1);
  });

  it('replays orphans silently for a silent ingestThreads, and clear() empties the buffer', () => {
    const fresh = new IgStore();
    const news = vi.fn();
    fresh.events.on('msg:new', news);
    fresh.ingestMessages([node('mid.$m1')]);
    fresh.ingestThreads(threadNodes, { silent: true });
    expect(news).not.toHaveBeenCalled();
    expect(fresh.find(T1, 'mid.$m1')).toBeDefined();
    const other = new IgStore();
    other.ingestMessages([node('mid.$m1')]);
    other.clear();
    other.ingestThreads(threadNodes, { silent: true });
    expect(other.find(T1, 'mid.$m1')).toBeUndefined();
  });

  it('caps the orphan buffer at 500, dropping the oldest', () => {
    const fresh = new IgStore();
    const many = Array.from({ length: 600 }, (_, i) => ({ ...node('mid.$m1'), id: 'item-o' + i, message_id: 'mid.$o' + i, timestamp_ms: String(1792090000000 + i) }));
    fresh.ingestMessages(many);
    fresh.ingestThreads(threadNodes, { silent: true });
    const ids = fresh.messagesOf(T1).map((m) => m.id);
    expect(ids).toHaveLength(500);
    expect(ids).not.toContain('mid.$o99');
    expect(ids).toContain('mid.$o100');
    expect(ids).toContain('mid.$o599');
  });

  it('evicts the oldest removed ids beyond 2000 and clear() resets the set', () => {
    const mk = (i: number) => ({ ...node('mid.$m1'), id: 'item-r' + i, message_id: 'mid.$r' + i });
    const many = Array.from({ length: 2001 }, (_, i) => mk(i));
    store.ingestMessages(many, { silent: true });
    for (let i = 0; i < 2001; i++) store.remove(T1, 'mid.$r' + i, true);
    store.ingestMessages([mk(0), mk(1)], { silent: true });
    expect(store.find(T1, 'mid.$r0')).toBeDefined();
    expect(store.find(T1, 'mid.$r1')).toBeUndefined();
    store.clear();
    store.ingestThreads(threadNodes, { silent: true });
    store.ingestMessages([mk(1)], { silent: true });
    expect(store.find(T1, 'mid.$r1')).toBeDefined();
  });

  it('orders equal-activity threads by id', () => {
    const same = threadNodes.map((n) => ({ ...n, last_activity_timestamp_ms: '1792090000000' }));
    const fresh = new IgStore();
    fresh.ingestThreads([same[1], same[0]], { silent: true });
    const ids = fresh.threads().map((x) => x.id);
    expect(ids).toEqual([...ids].sort());
    expect(fresh.threads().map((x) => x.lastActivityAt)[0]).toBe(fresh.threads().map((x) => x.lastActivityAt)[1]);
  });

  it('is idempotent for repeated records and duplicate removal ids', () => {
    const news = vi.fn();
    store.events.on('msg:new', news);
    store.ingestMessages(messageNodes);
    const count = store.messagesOf(T1).length;
    store.ingestMessages(messageNodes);
    expect(news).toHaveBeenCalledTimes(1);
    expect(store.messagesOf(T1)).toHaveLength(count);
    expect(store.candidatesForRemoval(['item-2', 'item-2'])).toHaveLength(1);
  });
});
