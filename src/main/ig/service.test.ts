import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_WINDOW_MS, type EngineState, type Thread } from '../../shared/types';
import { ServiceError } from '../chatService';
import { Emitter } from '../emitter';
import type { EngineLike, RelaySnapshot } from '../engine/types';
import threadList from './__fixtures__/threadList.json';
import messageList from './__fixtures__/messageList.json';
import { OPS } from './ops';
import { IgChatService, type CacheLike, type ExecLike, type RelayLike } from './service';
import { IgStore } from './store';

const threadNodes = threadList.data.fetch__SlideMailbox.threads_by_folder.edges.map((e) => e.node.as_ig_direct_thread);
const messageNodes = messageList.data.fetch__SlideThread.as_ig_direct_thread.slide_messages.edges.map((e) => e.node);
const T1 = '1000000000000001';
const NOW = 1792100000000;
const FIRE = String.fromCodePoint(0x1f525);

class FakeEngine implements EngineLike {
  state: EngineState = 'ready';
  needsUserReason: 'login' | 'challenge' = 'login';
  readonly events = new Emitter<{ state: (s: EngineState) => void }>();
  started = 0;
  stopped = 0;
  shown = 0;
  loggedOut = 0;
  navigated: string[] = [];
  onAttach: (threadId: string, filePath: string) => void = () => {};
  async start(): Promise<void> {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  showForUser(): void {
    this.shown++;
  }
  async logout(): Promise<void> {
    this.loggedOut++;
  }
  async navigateToThread(id: string): Promise<void> {
    this.navigated.push(id);
  }
  userThreads: Record<string, string> = {};
  canOpen = true;
  canOpenUserThread(): boolean {
    return this.canOpen;
  }
  opened: string[] = [];
  async openUserThread(username: string): Promise<string | null> {
    this.opened.push(username);
    return this.userThreads[username] ?? null;
  }
  async attachImage(threadId: string, filePath: string): Promise<void> {
    this.onAttach(threadId, filePath);
  }
  async isLoggedIn(): Promise<boolean> {
    return this.state !== 'needsUser';
  }
  set(s: EngineState): void {
    this.state = s;
    this.events.emit('state', s);
  }
}

class FakeExec implements ExecLike {
  readonly calls: { name: string; variables: Record<string, unknown> }[] = [];
  handlers: Record<string, (v: Record<string, unknown>) => unknown> = {};
  async run<T>(name: string, variables: unknown): Promise<T> {
    this.calls.push({ name, variables: variables as Record<string, unknown> });
    const h = this.handlers[name];
    if (!h) throw new ServiceError('Unknown', `no handler for ${name}`);
    return h(variables as Record<string, unknown>) as T;
  }
}

const snapshot = (): RelaySnapshot => ({
  threads: threadNodes,
  messages: messageNodes,
  removed: [],
  viewer: { id: '9000000001', username: 'me', full_name: 'Me', profile_pic_url: 'https://scontent.cdninstagram.com/me.jpg', fbid: '900000000000001' },
  inbox: { endCursor: 't2', hasMore: true }
});

let engine: FakeEngine;
let exec: FakeExec;
let store: IgStore;
let relay: { status: RelayLike['status']; snap: RelaySnapshot | null; snapshot: () => Promise<RelaySnapshot | null> };
let cache: CacheLike & { saved: Thread[][]; cached: Thread[] };
let svc: IgChatService;
let tmp: string;

beforeEach(() => {
  engine = new FakeEngine();
  exec = new FakeExec();
  store = new IgStore();
  relay = { status: 'live', snap: snapshot(), snapshot: async () => relay.snap };
  cache = { saved: [], cached: [], loadThreads: () => cache.cached, saveThreads: (t) => void cache.saved.push(t), clear: () => (cache.cached = []) };
  tmp = mkdtempSync(join(tmpdir(), 'igchat-svc-'));
  svc = new IgChatService({ engine, relay, exec, store, cache, tmpDir: tmp, now: () => NOW, sleep: async () => {}, timeouts: { ready: 50 } });
});

describe('IgChatService status', () => {
  it('starts the engine and maps engine state to sync status', () => {
    const statuses: string[] = [];
    svc.on('sync:status', (s) => statuses.push(s));
    svc.start();
    expect(engine.started).toBe(1);
    engine.set('starting');
    engine.needsUserReason = 'login';
    engine.set('needsUser');
    engine.needsUserReason = 'challenge';
    engine.set('broken');
    engine.set('needsUser');
    engine.set('ready');
    expect(statuses).toEqual(['ok', 'starting', 'authExpired', 'reconnecting', 'checkpoint', 'ok']);
  });

  it('never restarts the engine on its own when it breaks or needs the user', () => {
    svc.start();
    engine.set('broken');
    engine.set('needsUser');
    engine.set('starting');
    expect(engine.started).toBe(1);
    expect(engine.stopped).toBe(0);
  });

  it('rejects calls with AuthExpired while Instagram needs the user', async () => {
    engine.state = 'needsUser';
    await expect(svc.sendText(T1, 'hi', null)).rejects.toMatchObject({ code: 'AuthExpired' });
    await expect(svc.getInbox()).rejects.toMatchObject({ code: 'AuthExpired' });
  });

  it('times out with EngineNotReady while starting', async () => {
    engine.state = 'starting';
    await expect(svc.me()).rejects.toMatchObject({ code: 'EngineNotReady' });
  });
});

describe('IgChatService reads', () => {
  it('loads me and the inbox from the relay snapshot without any requests', async () => {
    expect((await svc.me()).username).toBe('me');
    const page = await svc.getInbox();
    expect(page.items.map((t) => t.id)).toEqual([T1, '1000000000000002']);
    expect(page.hasMore).toBe(true);
    expect(exec.calls).toHaveLength(0);
  });

  it('falls back to the thread-list query when the relay is unavailable', async () => {
    relay.snap = null;
    store.setViewer({ id: '9000000001', username: 'me', fullName: '', avatarUrl: '', verified: false }, '900000000000001');
    exec.handlers[OPS.threadList] = () => threadList.data;
    const page = await svc.getInbox();
    expect(page.items).toHaveLength(2);
    expect(exec.calls[0]).toMatchObject({ name: OPS.threadList, variables: { id: '900000000000001', cursor: null } });
  });

  it('serves the cached inbox while the engine is still starting', async () => {
    engine.state = 'starting';
    cache.cached = [{ id: 'cached', title: 'C', isGroup: false, participants: [], adminIds: [], lastActivityAt: 1, lastMessagePreview: '', unread: false, muted: false, avatarUrls: [] }];
    expect((await svc.getInbox()).items.map((t) => t.id)).toEqual(['cached']);
  });

  it('loads more inbox pages with the stored cursor', async () => {
    await svc.getInbox();
    exec.handlers[OPS.threadList] = () => ({ fetch__SlideMailbox: { threads_by_folder: { edges: [], page_info: { end_cursor: null, has_next_page: false } } } });
    expect(await svc.loadMoreInbox()).toEqual({ items: [], hasMore: false });
    expect(exec.calls[0]!.variables.cursor).toBe('t2');
  });

  it('opens a thread from what the page already loaded, navigating the engine', async () => {
    await svc.getInbox();
    const page = await svc.openThread(T1);
    expect(engine.navigated).toEqual([T1]);
    expect(page.messages.map((m) => m.id)).toContain('mid.$m1');
    expect(page.lastSeenMessageId).toBe('mid.$m11');
    expect(exec.calls).toHaveLength(0);
  });

  it('still opens a thread through the query when the engine cannot navigate', async () => {
    relay.snap = { ...snapshot(), messages: [] };
    await svc.getInbox();
    engine.navigateToThread = async () => {
      throw new ServiceError('Unknown', "Instagram didn't open the conversation");
    };
    exec.handlers[OPS.messageList] = () => messageList.data;
    expect((await svc.openThread(T1)).messages).toHaveLength(10);
  });

  it('falls back to the message-list query when the page delivers nothing', async () => {
    relay.snap = { ...snapshot(), messages: [] };
    await svc.getInbox();
    exec.handlers[OPS.messageList] = () => messageList.data;
    const page = await svc.openThread(T1);
    expect(exec.calls[0]).toMatchObject({ name: OPS.messageList, variables: { id: T1, older_than_message_id: null } });
    expect(page.messages).toHaveLength(10);
    expect(page.hasOlder).toBe(true);
  });

  it('loads older messages before the oldest one known', async () => {
    relay.snap = { ...snapshot(), messages: messageNodes.slice(6) };
    await svc.getInbox();
    exec.handlers[OPS.messageList] = () => ({ fetch__SlideThread: { as_ig_direct_thread: { slide_messages: { edges: messageNodes.slice(0, 3).map((node) => ({ node })), page_info: { has_next_page: false } } } } });
    const older = await svc.loadOlder(T1);
    expect(exec.calls[0]!.variables.older_than_message_id).toBe('mid.$m8');
    expect(older.messages.map((m) => m.id)).toEqual(['mid.$m1', 'mid.$m2', 'mid.$m3']);
    expect(older.hasOlder).toBe(false);
  });

  it('serves thread details from memory and marks seen without requests', async () => {
    await svc.getInbox();
    expect((await svc.getThreadDetails(T1)).title).toBe('Alex Rivera');
    await expect(svc.getThreadDetails('nope')).rejects.toMatchObject({ code: 'NotFound' });
    await svc.markSeen(T1);
    expect(exec.calls).toHaveLength(0);
  });
});

describe('IgChatService writes', () => {
  beforeEach(async () => {
    await svc.getInbox();
  });

  it('sends text with an offline threading id and returns the confirmed message', async () => {
    exec.handlers[OPS.sendText] = () => ({ xig_direct_text_send_with_slide_messaging_response: { message_id: 'mid.$new', timestamp_ms: String(NOW) } });
    const msg = await svc.sendText(T1, 'hello', 'mid.$m2', 'temp-3');
    const vars = exec.calls[0]!.variables;
    expect(vars).toMatchObject({ ig_thread_igid: T1, text: { sensitive_string_value: 'hello' }, reply_to_message_id: 'mid.$m2' });
    expect(vars.offline_threading_id).toMatch(/^\d{19}$/);
    expect(msg).toMatchObject({ id: 'mid.$new', kind: 'text', text: 'hello', senderId: '9000000001', clientTempId: 'temp-3', replyTo: { messageId: 'mid.$m2' } });
    expect(store.find(T1, 'mid.$new')).toBeDefined();
  });

  it('returns the echo if it arrived before the send call resolved', async () => {
    exec.handlers[OPS.sendText] = (v) => {
      store.ingestMessages([{ ...messageNodes[0], message_id: 'mid.$echo', id: 'item-echo', offline_threading_id: v.offline_threading_id }]);
      return { xig_direct_text_send_with_slide_messaging_response: { message_id: 'mid.$echo', timestamp_ms: String(NOW) } };
    };
    const news = vi.fn();
    svc.on('msg:new', news);
    const msg = await svc.sendText(T1, 'hey!', null, 'temp-4');
    expect(msg).toMatchObject({ id: 'mid.$echo', clientTempId: 'temp-4' });
    expect(news.mock.calls[0]![1][0]).toMatchObject({ id: 'mid.$echo', clientTempId: 'temp-4' });
  });

  const otidOf = (i: number): string => exec.calls[i]!.variables.offline_threading_id as string;
  const echoRecord = (otid: string) => ({ ...messageNodes[0], message_id: 'mid.$late', id: 'item-late', offline_threading_id: otid });
  const mk = (extra: Partial<ConstructorParameters<typeof IgChatService>[0]> = {}) =>
    new IgChatService({ engine, relay, exec, store, cache, tmpDir: tmp, now: () => NOW, sleep: async () => {}, ...extra });

  it('a definite failure rejects with its code, drops the pending otid and reuses the otid on retry', async () => {
    exec.handlers[OPS.sendText] = () => {
      throw new ServiceError('RateLimited', 'slow down');
    };
    await expect(svc.sendText(T1, 'x', null, 'temp-9')).rejects.toMatchObject({ code: 'RateLimited' });
    expect(store.isPending(otidOf(0))).toBe(false);
    await expect(svc.sendText(T1, 'x', null, 'temp-9')).rejects.toMatchObject({ code: 'RateLimited' });
    expect(otidOf(1)).toBe(otidOf(0));
  });

  it('an ambiguous failure followed by an echo during the wait resolves with the tagged message', async () => {
    exec.handlers[OPS.sendText] = () => {
      throw new ServiceError('Network', 'timed out', true);
    };
    let sleeps = 0;
    const s = mk({
      sleep: async () => {
        if (++sleeps === 3) store.ingestMessages([echoRecord(otidOf(0))]);
      }
    });
    expect(await s.sendText(T1, 'x', null, 'temp-a')).toMatchObject({ id: 'mid.$late', clientTempId: 'temp-a' });
  });

  it('an ambiguous failure with no echo rejects MaybeSent and still tags a late echo until the grace ends', async () => {
    exec.handlers[OPS.sendText] = () => {
      throw new ServiceError('EngineNotReady', 'page gone', true);
    };
    const s = mk({ timeouts: { sendEcho: 200, maybeGrace: 60_000 } });
    await expect(s.sendText(T1, 'x', null, 'temp-b')).rejects.toMatchObject({ code: 'MaybeSent' });
    expect(store.isPending(otidOf(0))).toBe(true);
    const news = vi.fn();
    s.on('msg:new', news);
    store.ingestMessages([echoRecord(otidOf(0))]);
    expect(news.mock.calls[0]![1][0]).toMatchObject({ id: 'mid.$late', clientTempId: 'temp-b' });
    s.stop();
  });

  it('drops the pending otid once the grace period ends', async () => {
    exec.handlers[OPS.sendText] = () => {
      throw new ServiceError('Network', 'timed out', true);
    };
    const s = mk({ timeouts: { sendEcho: 100, maybeGrace: 20 } });
    await expect(s.sendText(T1, 'x', null, 'temp-c')).rejects.toMatchObject({ code: 'MaybeSent' });
    await new Promise((r) => setTimeout(r, 60));
    expect(store.isPending(otidOf(0))).toBe(false);
  });

  it('a 2xx without a message id is treated as maybe sent, not as a retryable failure', async () => {
    exec.handlers[OPS.sendText] = () => ({});
    const s = mk({ timeouts: { sendEcho: 100, maybeGrace: 60_000 } });
    await expect(s.sendText(T1, 'x', null, 'temp-d')).rejects.toMatchObject({ code: 'MaybeSent' });
    s.stop();
  });

  it('unreact with no reaction of ours sends nothing', async () => {
    const m = await svc.unreact(T1, 'mid.$m3');
    expect(m.id).toBe('mid.$m3');
    expect(exec.calls).toHaveLength(0);
    await expect(svc.unreact(T1, 'nope')).rejects.toMatchObject({ code: 'NotFound' });
  });

  it('edits own recent text and refuses old or foreign messages', async () => {
    store.upsertOwn({ id: 'mid.$own', threadId: T1, senderId: '9000000001', timestamp: NOW - 1000, reactions: [], status: 'sent', kind: 'text', text: 'helo' });
    exec.handlers[OPS.edit] = () => ({ direct_edit_message_with_slide_messaging_response: { message_id: 'mid.$own', timestamp_ms: String(NOW) } });
    expect(await svc.editMessage(T1, 'mid.$own', 'hello')).toMatchObject({ text: 'hello', editedAt: NOW });
    store.upsertOwn({ id: 'mid.$old', threadId: T1, senderId: '9000000001', timestamp: NOW - EDIT_WINDOW_MS - 1, reactions: [], status: 'sent', kind: 'text', text: 'x' });
    await expect(svc.editMessage(T1, 'mid.$old', 'y')).rejects.toMatchObject({ code: 'EditWindowExpired' });
    await expect(svc.editMessage(T1, 'mid.$m2', 'y')).rejects.toBeInstanceOf(ServiceError);
  });

  it('unsends with the 39-digit thread id', async () => {
    exec.handlers[OPS.unsend] = () => ({ direct_unsend_message: true });
    await svc.unsendMessage(T1, 'mid.$m1');
    expect(exec.calls[0]!.variables).toEqual({ message_id: 'mid.$m1', send_data: { thread_id: '340282366841710300949128000000000000001' } });
    expect(store.find(T1, 'mid.$m1')).toBeUndefined();
    await expect(svc.unsendMessage('unknown', 'x')).rejects.toMatchObject({ code: 'NotFound' });
    exec.handlers[OPS.unsend] = () => ({ direct_unsend_message: false });
    await expect(svc.unsendMessage(T1, 'mid.$m2')).rejects.toMatchObject({ code: 'Unknown' });
  });

  it('reacts using the item id and applies the returned reactions; unreacts with the current emoji', async () => {
    exec.handlers[OPS.react] = (v) => {
      const input = v.input as Record<string, unknown>;
      return input.reaction_status === 'created'
        ? { xig_direct_reaction_send_with_slide_messaging_response: { slide_message: { reactions: [{ reaction: FIRE, sender_fbid: '900000000000001' }] } } }
        : {};
    };
    const reacted = await svc.react(T1, 'mid.$m3', FIRE);
    expect(exec.calls[0]!.variables.input).toMatchObject({ emoji: FIRE, item_id: 'item-3', message_id: 'mid.$m3', thread_id: T1, reaction_status: 'created' });
    expect(reacted.reactions).toEqual([{ emoji: FIRE, userIds: ['9000000001'] }]);
    const cleared = await svc.unreact(T1, 'mid.$m3');
    expect(exec.calls[1]!.variables.input).toMatchObject({ emoji: FIRE, reaction_status: 'deleted' });
    expect(cleared.reactions).toEqual([]);
  });

  const imageRecord = (id: string) => ({
    id: `item-${id}`,
    message_id: `mid.$${id}`,
    thread_fbid: T1,
    sender_fbid: '900000000000001',
    timestamp_ms: String(NOW),
    content_type: 'IMAGES',
    content: { __typename: 'SlideMessageImageContent', attachments: [{ attachment_cdn_url: 'https://scontent.cdninstagram.com/v/new.jpg', preview_width: 10, preview_height: 10 }] }
  });

  it('sends images through the page and returns the echoed image', async () => {
    let seenPath = '';
    engine.onAttach = (threadId, filePath) => {
      seenPath = filePath;
      expect(existsSync(filePath)).toBe(true);
      store.ingestMessages([{ ...imageRecord('img'), thread_fbid: threadId }]);
    };
    const msg = await svc.sendImage(T1, new Uint8Array([1, 2, 3]), 'image/png', 'temp-5');
    expect(msg).toMatchObject({ id: 'mid.$img', kind: 'image', clientTempId: 'temp-5' });
    expect(seenPath.endsWith('.png')).toBe(true);
    expect(existsSync(seenPath)).toBe(false);
    await expect(svc.sendImage(T1, new Uint8Array([1]), 'image/tiff', 'temp-6')).rejects.toBeInstanceOf(ServiceError);
  });

  it('waits for an echo that arrives after the file was handed over', async () => {
    let polls = 0;
    const slow = new IgChatService({
      engine,
      relay,
      exec,
      store,
      tmpDir: tmp,
      now: () => NOW,
      timeouts: { imageEcho: 1000 },
      sleep: async () => {
        if (++polls === 3) store.ingestMessages([imageRecord('late')]);
      }
    });
    expect(await slow.sendImage(T1, new Uint8Array([1]), 'image/jpeg', 't')).toMatchObject({ id: 'mid.$late', clientTempId: 't' });
  });

  it('rejects MaybeSent when the page never shows the image, and removes the temp file', async () => {
    const quiet = mk({ timeouts: { imageEcho: 300, maybeGrace: 60_000 } });
    const before = readdirSync(tmp).length;
    const err = await quiet.sendImage(T1, new Uint8Array([1]), 'image/jpeg', 't').catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'MaybeSent' });
    expect((err as Error).message).toMatch(/may have been sent/i);
    expect(readdirSync(tmp).length).toBe(before);
    quiet.stop();
  });

  it('tags a late image echo after MaybeSent and emits msg:updated', async () => {
    const s = mk({ timeouts: { imageEcho: 300, maybeGrace: 60_000 } });
    await expect(s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-late')).rejects.toMatchObject({ code: 'MaybeSent' });
    const updated = vi.fn();
    s.on('msg:updated', updated);
    store.ingestMessages([imageRecord('later')]);
    expect(updated).toHaveBeenCalledWith(T1, expect.objectContaining({ id: 'mid.$later', clientTempId: 'temp-late' }));
    expect(store.find(T1, 'mid.$later')).toMatchObject({ clientTempId: 'temp-late' });
    // A second image is not mistaken for the same send.
    updated.mockClear();
    store.ingestMessages([imageRecord('other')]);
    expect(updated).not.toHaveBeenCalled();
    s.stop();
  });

  it('ends the late-echo watcher of an earlier MaybeSent image when the next image is sent in the same thread', async () => {
    const s = mk({ timeouts: { imageEcho: 200, maybeGrace: 60_000 } });
    await expect(s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-A')).rejects.toMatchObject({ code: 'MaybeSent' });
    engine.onAttach = () => void store.ingestMessages([imageRecord('B')]);
    const updated = vi.fn();
    s.on('msg:updated', updated);
    const b = await s.sendImage(T1, new Uint8Array([2]), 'image/png', 'temp-B');
    expect(b).toMatchObject({ id: 'mid.$B', clientTempId: 'temp-B' });
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated).toHaveBeenCalledWith(T1, expect.objectContaining({ id: 'mid.$B', clientTempId: 'temp-B' }));
    expect(store.messagesOf(T1).filter((m) => m.clientTempId === 'temp-A')).toHaveLength(0);
    s.stop();
  });

  it('holds the queue and navigation until the attach call itself settles', async () => {
    let release!: () => void;
    let attaches = 0;
    engine.attachImage = () => {
      attaches++;
      return attaches === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
    };
    const s = mk({ timeouts: { attach: 20, imageEcho: 100, maybeGrace: 60_000 } });
    const first = s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-1');
    s.setActiveThread('1000000000000002');
    await expect(first).rejects.toMatchObject({ code: 'MaybeSent' });
    const second = s.sendImage(T1, new Uint8Array([2]), 'image/png', 'temp-2');
    await new Promise((r) => setTimeout(r, 30));
    expect(attaches).toBe(1);
    expect(engine.navigated).toEqual([]);
    release();
    await expect(second).rejects.toMatchObject({ code: 'MaybeSent' });
    expect(attaches).toBe(2);
    await vi.waitFor(() => expect(engine.navigated).toEqual(['1000000000000002']));
    s.stop();
  });

  it('does not reuse an otid for a temp id that was used in another thread', async () => {
    exec.handlers[OPS.sendText] = () => {
      throw new ServiceError('RateLimited', 'slow down');
    };
    await expect(svc.sendText(T1, 'x', null, 'temp-z')).rejects.toBeInstanceOf(ServiceError);
    await expect(svc.sendText('1000000000000002', 'x', null, 'temp-z')).rejects.toBeInstanceOf(ServiceError);
    expect(otidOf(1)).not.toBe(otidOf(0));
    await expect(svc.sendText('1000000000000002', 'x', null, 'temp-z')).rejects.toBeInstanceOf(ServiceError);
    expect(otidOf(2)).toBe(otidOf(1));
  });

  it('drops the otid mapping after a successful send', async () => {
    exec.handlers[OPS.sendText] = () => ({ xig_direct_text_send_with_slide_messaging_response: { message_id: 'mid.$ok', timestamp_ms: String(NOW) } });
    await svc.sendText(T1, 'x', null, 'temp-ok');
    await svc.sendText(T1, 'x', null, 'temp-ok');
    expect(otidOf(1)).not.toBe(otidOf(0));
  });

  it('emits msg:updated with the tag when the echo arrives during the call', async () => {
    const updated = vi.fn();
    svc.on('msg:updated', updated);
    engine.onAttach = () => void store.ingestMessages([imageRecord('now')]);
    await svc.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-now');
    expect(updated).toHaveBeenCalledWith(T1, expect.objectContaining({ id: 'mid.$now', clientTempId: 'temp-now' }));
  });

  it('does not match an old own image that shows up during the wait', async () => {
    engine.onAttach = () => void store.ingestMessages([{ ...imageRecord('old'), timestamp_ms: String(NOW - 60_000) }]);
    const s = mk({ timeouts: { imageEcho: 300, maybeGrace: 60_000 } });
    await expect(s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-old')).rejects.toMatchObject({ code: 'MaybeSent' });
    s.stop();
  });

  it('treats a hung attach as unknown after its deadline instead of wedging the queue', async () => {
    engine.attachImage = () => new Promise<void>(() => {});
    const s = mk({ timeouts: { attach: 20, imageEcho: 100, maybeGrace: 60_000 } });
    await expect(s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-h')).rejects.toMatchObject({ code: 'MaybeSent' });
    s.stop();
  });

  it('releases the image queue and navigation after the hold cap when an attach never settles', async () => {
    let attaches = 0;
    engine.attachImage = () => {
      attaches++;
      return new Promise<void>(() => {});
    };
    const s = mk({ timeouts: { attach: 20, imageEcho: 50, maybeGrace: 60_000, attachHold: 150 } });
    s.setActiveThread(T1);
    engine.navigated.length = 0;
    await expect(s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-a')).rejects.toMatchObject({ code: 'MaybeSent' });
    const second = s.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-b');
    await vi.waitFor(() => expect(attaches).toBe(2), { timeout: 2000 });
    await expect(second).rejects.toMatchObject({ code: 'MaybeSent' });
    await vi.waitFor(() => expect(engine.navigated).toContain(T1), { timeout: 2000 });
    s.stop();
  });

  it('does not navigate the page while an image is being handed over, and navigates once it is done', async () => {
    let release!: () => void;
    let started = false;
    engine.attachImage = () => {
      started = true;
      return new Promise<void>((resolve) => (release = resolve));
    };
    exec.handlers[OPS.messageList] = () => ({ fetch__SlideThread: { as_ig_direct_thread: { slide_messages: { edges: [], page_info: {} } } } });
    const send = svc.sendImage(T1, new Uint8Array([1]), 'image/png', 'temp-nav');
    await vi.waitFor(() => expect(started).toBe(true));
    await svc.openThread('1000000000000002');
    svc.setActiveThread('1000000000000002');
    expect(engine.navigated).toEqual([]);
    store.ingestMessages([imageRecord('nav')]);
    release();
    await send;
    await vi.waitFor(() => expect(engine.navigated).toEqual(['1000000000000002']));
  });

  it('serializes image sends so each waits for its own echo', async () => {
    let n = 0;
    engine.onAttach = () => {
      store.ingestMessages([imageRecord(`img${++n}`)]);
    };
    const [a, b] = await Promise.all([svc.sendImage(T1, new Uint8Array([1]), 'image/png', 'a'), svc.sendImage(T1, new Uint8Array([2]), 'image/png', 'b')]);
    expect(a).toMatchObject({ id: 'mid.$img1', clientTempId: 'a' });
    expect(b).toMatchObject({ id: 'mid.$img2', clientTempId: 'b' });
  });

  it('reports an attach failure before the handoff as that error', async () => {
    engine.attachImage = async () => {
      throw new ServiceError('EngineNotReady', 'not ready');
    };
    await expect(svc.sendImage(T1, new Uint8Array([1]), 'image/png', 'x')).rejects.toMatchObject({ code: 'EngineNotReady' });
  });
});

describe('IgChatService live data', () => {
  beforeEach(async () => {
    await svc.getInbox();
  });

  it('applies relay deltas and verifies removals against the newest page', async () => {
    const news = vi.fn();
    const removed = vi.fn();
    svc.on('msg:new', news);
    svc.on('msg:removed', removed);
    await svc.applyDelta({ threads: [], messages: [{ ...messageNodes[0], id: 'item-n', message_id: 'mid.$n', timestamp_ms: '1792100500000' }], removed: [] });
    expect(news).toHaveBeenCalledWith(T1, [expect.objectContaining({ id: 'mid.$n' })]);
    exec.handlers[OPS.messageList] = () => ({ fetch__SlideThread: { as_ig_direct_thread: { slide_messages: { edges: messageNodes.filter((n) => n.message_id !== 'mid.$m2').map((node) => ({ node })), page_info: {} } } } });
    await svc.applyDelta({ threads: [], messages: [], removed: ['item-2'] });
    expect(removed).toHaveBeenCalledWith(T1, 'mid.$m2');
  });

  it("notices an unsend when a thread's message list drops a message the page still keeps a record of", async () => {
    const removed = vi.fn();
    svc.on('msg:removed', removed);
    const without = messageNodes.filter((n) => n.message_id !== 'mid.$m2');
    exec.handlers[OPS.messageList] = () => ({ fetch__SlideThread: { as_ig_direct_thread: { slide_messages: { edges: without.map((node) => ({ node })), page_info: {} } } } });
    await svc.applyDelta({ threads: [{ ...threadNodes[0], slide_messages: { edges: without.map((node) => ({ node })) } }], messages: [], removed: [] });
    expect(removed).toHaveBeenCalledWith(T1, 'mid.$m2');
  });

  it('does not ask Instagram anything when a thread delta lists every message it already has', async () => {
    exec.calls.length = 0;
    const listed = messageNodes.slice(0, 5);
    await svc.applyDelta({ threads: [{ ...threadNodes[0], slide_messages: { edges: listed.map((node) => ({ node })) } }], messages: [], removed: [] });
    expect(exec.calls).toEqual([]);
  });

  it('keeps a message whose removal cannot be verified', async () => {
    const removed = vi.fn();
    svc.on('msg:removed', removed);
    await svc.applyDelta({ threads: [], messages: [], removed: ['item-2', 'item-2', 'unknown'] });
    expect(removed).not.toHaveBeenCalled();
    expect(store.find(T1, 'mid.$m2')).toBeDefined();
  });

  it('ingests the page own thread/message queries as a second source', () => {
    const updates = vi.fn();
    svc.on('inbox:updated', updates);
    svc.applyObservation({ name: OPS.threadList, docId: '1', variables: { id: '900000000000001' }, data: { fetch__SlideMailbox: { threads_by_folder: { edges: [{ node: { as_ig_direct_thread: { ...threadNodes[0], thread_title: 'Renamed' } } }] } } } });
    expect(updates).toHaveBeenCalledWith([expect.objectContaining({ id: T1, title: 'Renamed' })]);
  });

  it('ignores malformed observations', () => {
    expect(() => svc.applyObservation({ name: OPS.messageList, docId: '1', variables: null, data: 'garbage' })).not.toThrow();
  });

  it('refresh() re-reads the inbox and the active thread', async () => {
    exec.handlers[OPS.threadList] = () => threadList.data;
    exec.handlers[OPS.messageList] = () => messageList.data;
    svc.setActiveThread(T1);
    await svc.refresh();
    expect(exec.calls.map((c) => c.name)).toEqual([OPS.threadList, OPS.messageList]);
  });

  it('start() twice registers listeners once; logout clears the active thread', async () => {
    const statuses: string[] = [];
    svc.on('sync:status', (s) => statuses.push(s));
    svc.start();
    svc.start();
    expect(engine.started).toBe(1);
    engine.set('starting');
    expect(statuses.filter((s) => s === 'starting')).toHaveLength(1);
    svc.setActiveThread(T1);
    await svc.logout();
    expect(svc.activeThread).toBeNull();
  });

  it('refresh() keeps the stored cursor once the user has paged past the first page', async () => {
    exec.handlers[OPS.threadList] = () => ({ fetch__SlideMailbox: { threads_by_folder: { edges: [], page_info: { end_cursor: 't3', has_next_page: true } } } });
    await svc.loadMoreInbox();
    exec.handlers[OPS.threadList] = () => ({ fetch__SlideMailbox: { threads_by_folder: { edges: [], page_info: { end_cursor: 'first-page', has_next_page: true } } } });
    await svc.refresh();
    exec.handlers[OPS.threadList] = () => ({ fetch__SlideMailbox: { threads_by_folder: { edges: [], page_info: { end_cursor: null, has_next_page: false } } } });
    await svc.loadMoreInbox();
    expect(exec.calls.at(-1)!.variables.cursor).toBe('t3');
  });

  it('does not remove a message that ties with the oldest message of the verification page', async () => {
    const removed = vi.fn();
    svc.on('msg:removed', removed);
    const oldest = store.find(T1, 'mid.$m2')!.timestamp;
    // The page's oldest message shares m2's timestamp but is a different message: m2 must be kept.
    exec.handlers[OPS.messageList] = () => ({ fetch__SlideThread: { as_ig_direct_thread: { slide_messages: { edges: [{ node: { ...messageNodes[3], timestamp_ms: String(oldest) } }], page_info: {} } } } });
    await svc.applyDelta({ threads: [], messages: [], removed: ['item-2'] });
    expect(removed).not.toHaveBeenCalled();
  });

  it('refresh() does nothing while the engine is not ready', async () => {
    engine.state = 'broken';
    await svc.refresh();
    expect(exec.calls).toHaveLength(0);
  });

  it('saves the inbox to the cache when it changes, and clears everything on logout', async () => {
    svc.start();
    store.ingestThreads([{ ...threadNodes[0], thread_title: 'Changed' }]);
    expect(cache.saved.length).toBeGreaterThan(0);
    await svc.logout();
    expect(engine.loggedOut).toBe(1);
    expect(store.threads()).toEqual([]);
    await svc.login();
    expect(engine.shown).toBe(1);
    expect(await svc.authStatus()).toEqual({ loggedIn: true, engine: 'ready' });
    svc.setFocused(false);
    expect(svc.isFocused).toBe(false);
  });
});

const searchResult = (users: unknown[]) => ({ xfb_combinedIGSearchQuery: { search_messenger_contact_v2: users } });

describe('IgChatService people search', () => {
  beforeEach(async () => {
    await svc.getInbox();
  });

  it('searches Instagram for people', async () => {
    exec.handlers[OPS.search] = (v) => {
      expect(v).toEqual({ search_text: 'alex' });
      return searchResult([{ pk: '9000000002', username: 'alex_r', full_name: 'Alex Rivera', profile_pic_url: 'https://scontent.cdninstagram.com/a.jpg', is_verified: false }, { username: 'no-id' }]);
    };
    const people = await svc.searchPeople('alex');
    expect(people).toEqual([expect.objectContaining({ id: '9000000002', username: 'alex_r' })]);
    expect(await svc.searchPeople(' ')).toEqual([]);
  });

  it("asks the page for the search operation's id when it has not seen it, then searches", async () => {
    let known = false;
    exec.handlers[OPS.search] = () => {
      if (!known) throw new ServiceError('EngineNotReady', 'Unknown Instagram operation IGDOmniPickerSearchResultsListQuery');
      return searchResult([{ pk: '9000000002', username: 'alex_r', full_name: 'Alex Rivera' }]);
    };
    const resolveDocId = vi.fn(async (name: string) => {
      expect(name).toBe(OPS.search);
      known = true;
      return true;
    });
    const s = new IgChatService({ engine, relay, exec, store, tmpDir: tmp, now: () => NOW, sleep: async () => {}, timeouts: { ready: 50 }, resolveDocId });
    expect(await s.searchPeople('alex')).toEqual([expect.objectContaining({ username: 'alex_r' })]);
    expect(resolveDocId).toHaveBeenCalledTimes(1);
  });

  it('still reports search as unavailable when the page cannot supply the id', async () => {
    exec.handlers[OPS.search] = () => {
      throw new ServiceError('EngineNotReady', 'Unknown Instagram operation IGDOmniPickerSearchResultsListQuery');
    };
    const s = new IgChatService({ engine, relay, exec, store, tmpDir: tmp, now: () => NOW, sleep: async () => {}, timeouts: { ready: 50 }, resolveDocId: async () => false });
    await expect(s.searchPeople('alex')).rejects.toMatchObject({ message: "People search isn't available yet" });
  });

  it('opens an existing DM with a person without navigating', async () => {
    const t = await svc.openThreadWithUser('9000000002');
    expect(t.id).toBe(T1);
    expect(engine.navigated).toEqual([]);
    expect(engine.opened).toEqual([]);
  });

  it('opens a DM it did not know through the page, creating a placeholder thread', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend', full_name: 'New Friend', is_verified: false }]);
    await svc.searchPeople('new');
    engine.userThreads.new_friend = '1000000000000077';
    const t = await svc.openThreadWithUser('9000000077');
    expect(t).toMatchObject({ id: '1000000000000077', title: 'New Friend', isGroup: false });
    expect(t.participants.map((p) => p.username)).toEqual(['new_friend']);
    expect((await svc.getThreadDetails('1000000000000077')).id).toBe('1000000000000077');
  });

  it('fails clearly when the person is unknown or Instagram cannot open the chat', async () => {
    await expect(svc.openThreadWithUser('nobody')).rejects.toMatchObject({ code: 'NotFound' });
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000088', username: 'ghost', full_name: '' }]);
    await svc.searchPeople('ghost');
    await expect(svc.openThreadWithUser('9000000088')).rejects.toMatchObject({ code: 'Unknown' });
  });

  it('does not navigate the page while an image is being handed over', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend', full_name: 'New Friend' }]);
    await svc.searchPeople('new');
    let release: () => void = () => {};
    let attaching = false;
    engine.attachImage = () =>
      new Promise<void>((r) => {
        attaching = true;
        release = r;
      });
    const sent = svc.sendImage(T1, new Uint8Array([1]), 'image/png').catch(() => {});
    await expect(svc.openThreadWithUser('9000000077')).rejects.toMatchObject({ code: 'EngineNotReady' });
    expect(engine.opened).toEqual([]);
    await vi.waitFor(() => expect(attaching).toBe(true));
    release();
    await sent;
  });

  it('keeps later real-thread ingestion working after a placeholder', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend', full_name: 'New Friend' }]);
    await svc.searchPeople('new');
    engine.userThreads.new_friend = '1000000000000077';
    await svc.openThreadWithUser('9000000077');
    const seen: string[] = [];
    svc.on('inbox:updated', (ts) => seen.push(...ts.map((t) => t.id)));
    store.ingestThreads([{ id: '1000000000000077', thread_fbid: '1000000000000077', thread_title: 'Real Title', is_group: false, users: [] }]);
    expect(seen).toEqual(['1000000000000077']);
    expect(store.thread('1000000000000077')?.title).toBe('Real Title');
  });

  it('shares one request between identical concurrent searches', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend' }]);
    const [a, b] = await Promise.all([svc.searchPeople('new'), svc.searchPeople('new ')]);
    expect(a).toEqual(b);
    expect(exec.calls.filter((c) => c.name === OPS.search)).toHaveLength(1);
  });
  it('reports a distinct error when the search operation is not known yet', async () => {
    exec.handlers[OPS.search] = () => {
      throw new ServiceError('EngineNotReady', 'Unknown Instagram operation ' + OPS.search);
    };
    await expect(svc.searchPeople('alex')).rejects.toMatchObject({ code: 'EngineNotReady', message: "People search isn't available yet" });
  });

  it('a late person-open does not take over the active thread after a newer selection', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend', full_name: 'New Friend' }]);
    await svc.searchPeople('new');
    let finish: (id: string) => void = () => {};
    let started = false;
    engine.openUserThread = () =>
      new Promise<string | null>((r) => {
        started = true;
        finish = r;
      });
    const opening = svc.openThreadWithUser('9000000077');
    await vi.waitFor(() => expect(started).toBe(true));
    svc.setActiveThread(T1);
    finish('1000000000000077');
    await opening;
    expect(svc.activeThread).toBe(T1);
  });

  it('refuses with RateLimited when the engine has spent its person-open budget', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend', full_name: 'New Friend' }]);
    await svc.searchPeople('new');
    engine.canOpen = false;
    await expect(svc.openThreadWithUser('9000000077')).rejects.toMatchObject({ code: 'RateLimited' });
    expect(engine.opened).toEqual([]);
  });

  it('passes through AuthExpired from a login wall during the hop', async () => {
    exec.handlers[OPS.search] = () => searchResult([{ pk: '9000000077', username: 'new_friend', full_name: 'New Friend' }]);
    await svc.searchPeople('new');
    engine.openUserThread = async () => {
      throw new ServiceError('AuthExpired', 'Log in to Instagram');
    };
    await expect(svc.openThreadWithUser('9000000077')).rejects.toMatchObject({ code: 'AuthExpired' });
  });
});
