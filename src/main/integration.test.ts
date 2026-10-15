/// <reference lib="dom" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(), openPath: vi.fn() } }));

import type { Bridge, EventChannel, EventMap, InvokeChannel } from '../shared/ipc';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { setBridge } from '../renderer/src/lib/api';
import { inbox } from '../renderer/src/stores/inbox.svelte';
import { messages } from '../renderer/src/stores/messages.svelte';
import { settings } from '../renderer/src/stores/settings.svelte';
import { ui } from '../renderer/src/stores/ui.svelte';
import { createHandlers } from './handlers';
import { forwardEvents, registerIpc, type IpcLike } from './ipc';
import { MockChatService } from './mock/mockService';
import { SettingsStore } from './settingsStore';

const MINUTE = 60_000;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let dir: string;
let clock: number;
let service: MockChatService;
let stopForwarding: () => void;

function mockOptions(now: () => number): ConstructorParameters<typeof MockChatService>[0] {
  return { latencyMs: 0, incomingEveryMs: 0, now };
}

/** Real main-process wiring behind the renderer Bridge interface, structured-cloning both ways like Electron IPC. */
function createAdapter(): Bridge {
  const store = new SettingsStore(join(dir, 'settings.json'));
  const handlersByChannel = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcLike = { handle: (channel, listener) => handlersByChannel.set(channel, (...args) => listener({} as never, ...args)) };
  registerIpc(ipc, createHandlers({ service, settings: store, getWindow: () => null, themesDir: join(dir, 'themes') }));

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const sender = {
    isDestroyed: () => false,
    send(channel: string, ...args: unknown[]) {
      const cloned = structuredClone(args);
      for (const fn of listeners.get(channel) ?? []) fn(...cloned);
    }
  };
  stopForwarding = forwardEvents(service, () => sender);

  return {
    initialSettings: store.get(),
    initialCustomThemes: [],
    async invoke(channel: InvokeChannel, ...args: unknown[]) {
      const handler = handlersByChannel.get(channel);
      if (!handler) throw new Error(`unregistered ${channel}`);
      return structuredClone(await handler(...structuredClone(args))) as never;
    },
    on<E extends EventChannel>(event: E, listener: EventMap[E]) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      const fn = listener as (...args: unknown[]) => void;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    }
  } as Bridge;
}

let offs: (() => void)[];
let threadId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'igchat-int-'));
  clock = 1_700_000_000_000;
  service = new MockChatService(mockOptions(() => clock));
  setBridge(createAdapter());
  messages.byThread = {};
  inbox.threads = [];
  inbox.activeId = null;
  ui.toasts = [];
  ui.editingId = null;
  ui.replyTo = null;
  settings.init(DEFAULT_SETTINGS);
  offs = [inbox.subscribe(), messages.subscribe()];
  await inbox.load();
  threadId = inbox.threads[0]!.id;
  inbox.select(threadId);
  await messages.open(threadId);
});

afterEach(() => {
  offs.forEach((off) => off());
  stopForwarding();
  rmSync(dir, { recursive: true, force: true });
});

const mine = (text: string) => messages.get(threadId)!.messages.find((m) => m.kind === 'text' && m.text === text);

describe('renderer stores against real main handlers', () => {
  it('lists threads and shows messages for an open thread', () => {
    expect(inbox.me?.id).toBeTruthy();
    expect(inbox.threads.length).toBeGreaterThan(1);
    expect(messages.get(threadId)!.loaded).toBe(true);
    expect(messages.get(threadId)!.messages.length).toBeGreaterThan(0);
  });

  it('confirms a sent message and updates the inbox preview', async () => {
    await messages.sendText(threadId, 'hello there', null);
    const m = mine('hello there')!;
    expect(m.status).toBe('sent');
    expect(m.id.startsWith('temp-')).toBe(false);
    expect(messages.get(threadId)!.messages.filter((x) => x.kind === 'text' && x.text === 'hello there')).toHaveLength(1);
    expect(inbox.byId(threadId)!.lastMessagePreview).toContain('hello there');
  });

  it('marks [fail] sends failed, keeps failing on retry, and discards', async () => {
    await messages.sendText(threadId, 'nope [fail]', null);
    const failed = mine('nope [fail]')!;
    expect(failed.status).toBe('failed');
    await messages.retry(threadId, failed.id);
    expect(mine('nope [fail]')!.status).toBe('failed');
    messages.discard(threadId, failed.id);
    expect(mine('nope [fail]')).toBeUndefined();
  });

  it('keeps an edit made within the window', async () => {
    await messages.sendText(threadId, 'first', null);
    const id = mine('first')!.id;
    clock += 5 * MINUTE;
    await messages.edit(threadId, id, 'second');
    expect(mine('second')?.id).toBe(id);
    expect(ui.toasts).toHaveLength(0);
  });

  it('reverts an edit after the window with a "Too late" toast', async () => {
    await messages.sendText(threadId, 'first', null);
    const id = mine('first')!.id;
    clock += 16 * MINUTE;
    await messages.edit(threadId, id, 'second');
    expect(mine('first')?.id).toBe(id);
    expect(mine('second')).toBeUndefined();
    expect(ui.toasts[0]?.text).toContain('Too late');
  });

  it('unsends a message and refreshes the preview', async () => {
    await messages.sendText(threadId, 'to unsend', null);
    expect(inbox.byId(threadId)!.lastMessagePreview).toContain('to unsend');
    await messages.unsend(threadId, mine('to unsend')!.id);
    expect(mine('to unsend')).toBeUndefined();
    expect(inbox.byId(threadId)!.lastMessagePreview).not.toContain('to unsend');
  });

  describe('incoming messages', () => {
    /** Same options and seed give the same random pick, so a throwaway twin reveals which thread gets the next message. */
    function nextIncomingThread(): string {
      const twin = new MockChatService(mockOptions(() => clock));
      let target = '';
      twin.on('msg:new', (id) => {
        target = id;
      });
      twin.simulateIncoming('message');
      return target;
    }

    it('appends to the active thread and keeps it read', async () => {
      const target = nextIncomingThread();
      await messages.open(target);
      inbox.select(target);
      const before = messages.get(target)!.messages.length;
      service.simulateIncoming('message');
      await flush();
      expect(messages.get(target)!.messages.length).toBe(before + 1);
      expect(inbox.byId(target)!.unread).toBe(false);
      expect(messages.get(target)!.firstUnreadId).toBeNull();
    });

    it('marks an inactive thread unread and records the first unread message', async () => {
      const target = nextIncomingThread();
      await messages.open(target);
      inbox.select(target === threadId ? inbox.threads.find((t) => t.id !== target)!.id : threadId);
      service.simulateIncoming('message');
      await flush();
      const st = messages.get(target)!;
      expect(inbox.byId(target)!.unread).toBe(true);
      expect(st.firstUnreadId).toBe(st.messages[st.messages.length - 1]!.id);
    });
  });

  it('round-trips settings through the real SettingsStore', async () => {
    await settings.update({ themeId: 'nord', compact: true });
    expect(settings.value.themeId).toBe('nord');
    expect(settings.value.compact).toBe(true);
    const persisted = new SettingsStore(join(dir, 'settings.json')).get();
    expect(persisted.themeId).toBe('nord');
    expect(persisted.compact).toBe(true);
  });
});
