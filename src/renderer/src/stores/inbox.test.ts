import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeThread, makeUser } from '../../../shared/test/factories';
import type { Thread } from '../../../shared/types';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { playSound } from '../lib/sound';
import { inbox } from './inbox.svelte';

vi.mock('../lib/sound', () => ({ playSound: vi.fn(() => Promise.resolve()) }));

let bridge: FakeBridge;
const a = makeThread({ id: 'a', lastActivityAt: 30 });
const b = makeThread({ id: 'b', lastActivityAt: 20, unread: true });
const c = makeThread({ id: 'c', lastActivityAt: 10 });
const d = makeThread({ id: 'd', lastActivityAt: 5 });

beforeEach(() => {
  bridge = createFakeBridge({
    'session:me': () => makeUser({ id: 'me' }),
    'inbox:get': () => ({ items: [b, a, c], hasMore: true }),
    'inbox:loadMore': () => ({ items: [c, d], hasMore: false }),
    'thread:markSeen': () => undefined
  });
  setBridge(bridge);
  inbox.threads = [];
  inbox.activeId = null;
  inbox.me = null;
  inbox.hasMore = false;
  inbox.syncStatus = 'ok';
});

describe('inbox store', () => {
  it('loads me and threads sorted by activity', async () => {
    await inbox.load();
    expect(inbox.me?.id).toBe('me');
    expect(inbox.threads.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(inbox.hasMore).toBe(true);
  });

  it('loads more without duplicates', async () => {
    await inbox.load();
    await inbox.loadMore();
    expect(inbox.threads.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(inbox.hasMore).toBe(false);
  });

  it('merges updates, re-sorts, and adds new threads', async () => {
    await inbox.load();
    inbox.applyUpdates([{ ...c, lastActivityAt: 99, lastMessagePreview: 'new!' }, makeThread({ id: 'z', lastActivityAt: 50 })]);
    expect(inbox.threads.map((t) => t.id)).toEqual(['c', 'z', 'a', 'b']);
    expect(inbox.byId('c')?.lastMessagePreview).toBe('new!');
  });

  it('keeps the active thread read and tells main it was seen', async () => {
    await inbox.load();
    inbox.select('a');
    inbox.applyUpdates([{ ...a, unread: true, lastActivityAt: 100 }]);
    expect(inbox.active?.unread).toBe(false);
    expect(bridge.calls.some((c) => c.channel === 'thread:markSeen' && c.args[0] === 'a')).toBe(true);
  });

  it('selecting clears unread locally', async () => {
    await inbox.load();
    inbox.select('b');
    expect(inbox.active?.id).toBe('b');
    expect(inbox.byId('b')?.unread).toBe(false);
  });

  it('steps through threads in sidebar order and clamps at the ends', async () => {
    await inbox.load();
    expect(inbox.step(1)).toBe('a');
    inbox.select('a');
    expect(inbox.step(1)).toBe('b');
    expect(inbox.step(-1)).toBeNull();
    inbox.select('c');
    expect(inbox.step(1)).toBeNull();
  });

  it('reacts to pushed events', async () => {
    await inbox.load();
    const off = inbox.subscribe();
    bridge.emit('inbox:updated', [{ ...c, lastActivityAt: 1000 } as Thread]);
    bridge.emit('sync:status', 'reconnecting');
    expect(inbox.threads[0]!.id).toBe('c');
    expect(inbox.syncStatus).toBe('reconnecting');
    off();
  });

  it('reloads the inbox when sync becomes ok after starting', async () => {
    await inbox.load();
    const off = inbox.subscribe();
    const before = bridge.calls.filter((c) => c.channel === 'inbox:get').length;
    bridge.emit('sync:status', 'starting');
    bridge.emit('sync:status', 'ok');
    await Promise.resolve();
    expect(bridge.calls.filter((c) => c.channel === 'inbox:get').length).toBe(before + 1);
    off();
  });
});

describe('inbox profile', () => {
  it('asks for the profile again once the backend shows life, if the first ask failed', async () => {
    let ready = false;
    bridge = createFakeBridge({
      'session:me': () => {
        if (!ready) throw new Error('Instagram is still loading');
        return makeUser({ id: 'me', username: 'me_real', avatarUrl: 'igmedia://m/x' });
      },
      'inbox:get': () => ({ items: [a], hasMore: false })
    });
    setBridge(bridge);
    const off = inbox.subscribe();
    await inbox.load();
    expect(inbox.me).toBeNull();
    ready = true;
    // Any sign of life (an inbox update, or the status reporting ok again) fetches it.
    bridge.emit('inbox:updated', [a]);
    await vi.waitFor(() => expect(inbox.me?.username).toBe('me_real'));
    off();
  });

  it('replaces a profile without a photo when a complete one is available', async () => {
    let withPhoto = false;
    bridge = createFakeBridge({
      'session:me': () => makeUser({ id: 'me', username: 'me_real', avatarUrl: withPhoto ? 'igmedia://m/x' : '' }),
      'inbox:get': () => ({ items: [a], hasMore: false })
    });
    setBridge(bridge);
    const off = inbox.subscribe();
    await inbox.load();
    expect(inbox.me?.avatarUrl).toBe('');
    withPhoto = true;
    // After a photo-less answer it waits 10 s before asking again.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    bridge.emit('sync:status', 'ok');
    vi.useRealTimers();
    await vi.waitFor(() => expect(inbox.me?.avatarUrl).toBe('igmedia://m/x'));
    // Once complete, it stops asking.
    const asked = bridge.calls.filter((c) => c.channel === 'session:me').length;
    bridge.emit('inbox:updated', [a]);
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.calls.filter((c) => c.channel === 'session:me').length).toBe(asked);
    off();
  });

  describe('notification sound', () => {
    const play = vi.mocked(playSound);
    let off: () => void;
    // The store throttles sounds across calls, so each test starts well after the last one played.
    let clock = 10_000_000;
    beforeEach(async () => {
      clock += 60_000;
      await inbox.load();
      off = inbox.subscribe();
      play.mockClear();
      vi.useFakeTimers({ now: clock });
    });
    afterEach(() => {
      off();
      vi.useRealTimers();
    });

    it('plays for a live update that brings a new incoming message', () => {
      bridge.emit('inbox:updated', [{ ...c, lastActivityAt: 40, unread: true }]);
      expect(play).toHaveBeenCalledTimes(1);
      expect(play).toHaveBeenCalledWith('chime', 0.6);
    });

    it('stays quiet for own sends, muted chats, fetched pages and bursts', () => {
      bridge.emit('inbox:updated', [{ ...c, lastActivityAt: 40, unread: false }]);
      bridge.emit('inbox:updated', [{ ...c, lastActivityAt: 41, unread: true, muted: true }]);
      inbox.applyUpdates([{ ...a, lastActivityAt: 42, unread: true }]);
      expect(play).not.toHaveBeenCalled();
      bridge.emit('inbox:updated', [{ ...b, lastActivityAt: 50, unread: true }]);
      bridge.emit('inbox:updated', [{ ...b, lastActivityAt: 51, unread: true }]);
      expect(play).toHaveBeenCalledTimes(1);
    });
  });
});
