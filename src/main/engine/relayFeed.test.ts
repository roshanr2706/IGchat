import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BRIDGE from './relayBridge.page.js?raw';
import { MAX_RELAY_PAYLOAD, parseRelayPayload, RELAY_BINDING, RelayFeed } from './relayFeed';
import { FakeCdp, FakePage, flush } from './testing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const w = window as unknown as Record<string, unknown>;

function relayRecords(): Record<string, Rec> {
  return {
    'client:root': { __id: 'client:root', __typename: '__Root' },
    mbx: { __id: 'mbx', __typename: 'SlideMailbox', 'threads_by_folder(first:15,folder:"INBOX")': { __ref: 'conn' } },
    conn: { __id: 'conn', __typename: 'SlideMailboxThreadsByFolderConnection', edges: { __refs: [] }, page_info: { __ref: 'pi' } },
    pi: { __id: 'pi', __typename: 'PageInfo', end_cursor: 'c15', has_next_page: true },
    th1: {
      __id: 'th1', __typename: 'XFBIGDirectViewerThread', id: '100', thread_fbid: '100', thread_id: '3402', thread_title: '', is_group: false,
      users: { __refs: ['u2'] }, viewer: { __ref: 'u1' },
      'slide_messages(first:5)': { __ref: 'smc5' }, 'slide_messages(first:20)': { __ref: 'smc20' }
    },
    smc5: { __id: 'smc5', __typename: 'Conn', edges: { __refs: [] }, page_info: null },
    smc20: { __id: 'smc20', __typename: 'Conn', edges: { __refs: ['e1'] }, page_info: null },
    e1: { __id: 'e1', __typename: 'Edge', node: { __ref: 'mid.$m1' }, cursor: 'x' },
    u1: { __id: 'u1', __typename: 'XDTUserDict', id: '9000000001', interop_messaging_user_fbid: '900000000000001', profile_pic_url: 'https://scontent.cdninstagram.com/me.jpg' },
    u2: { __id: 'u2', __typename: 'XDTUserDict', id: '9000000002', username: 'alex_r', interop_messaging_user_fbid: '900000000000002' },
    'mid.$m1': { __id: 'mid.$m1', __typename: 'SlideMessage', id: 'item-1', message_id: 'mid.$m1', thread_fbid: '100', sender_fbid: '900000000000002', timestamp_ms: '1', content_type: 'TEXT', content: { __ref: 'c1' } },
    c1: { __id: 'c1', __typename: 'SlideMessageText', text_body: 'hi' }
  };
}

let records: Record<string, Rec>;
let failGet = false;
let store: { notify: (...args: unknown[]) => unknown; getSource: () => unknown };
let cdp: FakeCdp;
let page: FakePage;

beforeEach(() => {
  records = relayRecords();
  failGet = false;
  const source = {
    getRecordIDs: () => Object.keys(records),
    get: (id: string) => {
      if (failGet) throw new Error('boom');
      return records[id];
    }
  };
  store = { notify: () => {}, getSource: () => source };
  const env = { getStore: () => store };
  w.require = (name: string) => {
    if (name === 'PolarisRelayEnvironmentFactory') return { defaultEnvironment: env };
    if (name === 'PolarisViewer') return { data: { id: '9000000001', username: 'me', full_name: 'Me', profile_pic_url: 'https://scontent.cdninstagram.com/me.jpg' } };
    throw new Error(`Requiring unknown module "${name}"`);
  };
  cdp = new FakeCdp();
  page = new FakePage();
  // Evaluate scripts for real in this jsdom window, the way the engine page would.
  page.handler = (script) => (0, eval)(script);
  // CDP's Runtime.addBinding creates this function inside the page.
  w[RELAY_BINDING] = (payload: string) => cdp.fire('Runtime.bindingCalled', { name: RELAY_BINDING, payload });
});

afterEach(() => {
  vi.useRealTimers();
  delete w.require;
  delete w.__igchatRelay;
  delete w[RELAY_BINDING];
  document.body.innerHTML = '';
});

describe('relay bridge + feed', () => {
  it('installs, registers the binding and snapshots threads, messages, viewer and inbox paging', async () => {
    const feed = new RelayFeed(cdp, page, { retries: 1, sleep: async () => {} });
    await feed.attach();
    expect(cdp.sent.map((s) => s.method)).toEqual(['Runtime.enable', 'Runtime.addBinding']);
    expect(await feed.install()).toBe('live');
    expect(feed.status).toBe('live');
    const snap = (await feed.snapshot())!;
    expect(snap.viewer).toMatchObject({ id: '9000000001', username: 'me', fbid: '900000000000001' });
    expect(snap.inbox).toEqual({ endCursor: 'c15', hasMore: true });
    expect(snap.messages).toEqual([expect.objectContaining({ message_id: 'mid.$m1', content: { __typename: 'SlideMessageText', text_body: 'hi' } })]);
    const thread = snap.threads[0] as Rec;
    expect(thread.users[0]).toMatchObject({ username: 'alex_r' });
    expect(thread.slide_messages.edges).toHaveLength(1);
    expect(thread.viewer).toMatchObject({ interop_messaging_user_fbid: '900000000000001' });
  });

  it('pushes only changed records after the store notifies', async () => {
    vi.useFakeTimers();
    const feed = new RelayFeed(cdp, page, { retries: 1, sleep: async () => {} });
    await feed.attach();
    await feed.install();
    const deltas = vi.fn();
    feed.events.on('delta', deltas);
    records.c1 = { ...records.c1, text_body: 'edited' };
    store.notify();
    store.notify();
    vi.advanceTimersByTime(100);
    expect(deltas).toHaveBeenCalledTimes(1);
    const d = deltas.mock.calls[0]![0];
    expect(d.messages).toEqual([expect.objectContaining({ message_id: 'mid.$m1', content: expect.objectContaining({ text_body: 'edited' }) })]);
    expect(d.removed).toEqual([]);
    delete records['mid.$m1'];
    store.notify();
    vi.advanceTimersByTime(100);
    expect(deltas.mock.calls[1]![0].removed).toEqual(['mid.$m1']);
  });

  it('reports unavailable when the store cannot be found', async () => {
    w.require = () => {
      throw new Error('nope');
    };
    const statuses: string[] = [];
    const feed = new RelayFeed(cdp, page, { retries: 2, sleep: async () => {} });
    feed.events.on('status', (s) => statuses.push(s));
    expect(await feed.install()).toBe('unavailable');
    expect(page.scripts).toHaveLength(2);
    expect(statuses).toEqual(['pending', 'unavailable']);
    expect(await feed.snapshot()).toBeNull();
  });

  it('treats a second install as live', async () => {
    const feed = new RelayFeed(cdp, page, { retries: 1, sleep: async () => {} });
    expect(await feed.install()).toBe('live');
    expect(await feed.install()).toBe('live');
  });

  it('ignores binding calls with other names', async () => {
    const feed = new RelayFeed(cdp, page);
    await feed.attach();
    const deltas = vi.fn();
    feed.events.on('delta', deltas);
    cdp.fire('Runtime.bindingCalled', { name: 'somethingElse', payload: '{"threads":[],"messages":[],"removed":[]}' });
    await flush();
    expect(deltas).not.toHaveBeenCalled();
  });
});

describe('relay bridge hardening', () => {
  const feedOf = () => new RelayFeed(cdp, page, { retries: 2, sleep: async () => {} });

  it('a second install returns already and wraps notify once', async () => {
    const original = vi.fn();
    store.notify = original;
    const feed = feedOf();
    expect(await feed.install()).toBe('live');
    const wrapped = store.notify;
    expect(await feed.install()).toBe('live');
    expect(store.notify).toBe(wrapped);
    // Even with the page API gone, the marked wrapper is detected.
    delete w.__igchatRelay;
    expect((0, eval)(`${BRIDGE}("x")`)).toBe('already');
    expect(store.notify).toBe(wrapped);
    store.notify();
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('a retry after a failing scan does not stack wrappers', async () => {
    const original = vi.fn();
    store.notify = original;
    const src = store.getSource() as { getRecordIDs: () => string[] };
    const ids = src.getRecordIDs;
    let n = 0;
    src.getRecordIDs = () => {
      if (n++ === 0) throw new Error('not ready');
      return ids();
    };
    expect(await feedOf().install()).toBe('live');
    expect(page.scripts).toHaveLength(2);
    store.notify();
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('keeps this, args and return value of the original notify', async () => {
    const seen: { self: unknown; args: unknown[] }[] = [];
    store.notify = function (this: unknown, ...args: unknown[]) {
      seen.push({ self: this, args });
      return 'ret';
    };
    await feedOf().install();
    expect(store.notify.call(store, 1, 2)).toBe('ret');
    expect(seen).toEqual([{ self: store, args: [1, 2] }]);
  });

  it('does not throw into the page when the store throws during a flush, and retries later', async () => {
    vi.useFakeTimers();
    const feed = feedOf();
    await feed.attach();
    await feed.install();
    const deltas = vi.fn();
    feed.events.on('delta', deltas);
    records.c1 = { ...records.c1, text_body: 'edited' };
    failGet = true;
    store.notify();
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(deltas).not.toHaveBeenCalled();
    failGet = false;
    store.notify();
    vi.advanceTimersByTime(100);
    expect(deltas).toHaveBeenCalledTimes(1);
  });

  it('chunks an oversized delta without losing records and counts unsendable ones', async () => {
    vi.useFakeTimers();
    const feed = feedOf();
    await feed.attach();
    await feed.install();
    const got: string[] = [];
    feed.events.on('delta', (d) => got.push(...d.messages.map((m) => (m as Rec).message_id)));
    for (const n of [1, 2, 3]) {
      records[`mid.$big${n}`] = { __id: `mid.$big${n}`, __typename: 'SlideMessage', message_id: `mid.$big${n}`, blob: 'x'.repeat(3_000_000) };
    }
    store.notify();
    vi.advanceTimersByTime(100);
    expect([...got].sort()).toEqual(['mid.$big1', 'mid.$big2', 'mid.$big3']);
    expect(feed.dropped).toBe(0);
    records['mid.$huge'] = { __id: 'mid.$huge', __typename: 'SlideMessage', message_id: 'mid.$huge', blob: 'x'.repeat(8_000_000) };
    records.c1 = { ...records.c1, text_body: 'again' };
    store.notify();
    vi.advanceTimersByTime(100);
    expect(feed.dropped).toBe(1);
    expect(got).toContain('mid.$m1');
    expect(got).not.toContain('mid.$huge');
  });

  it('snapshot reports removals', async () => {
    const feed = feedOf();
    await feed.install();
    delete records['mid.$m1'];
    expect((await feed.snapshot())!.removed).toEqual(['mid.$m1']);
  });

  it('finds the environment in a non-first React root', async () => {
    w.require = () => {
      throw new Error('nope');
    };
    const mk = (fiber: unknown) => {
      const el = document.createElement('div');
      (el as unknown as Record<string, unknown>)['__reactContainer$t'] = { current: fiber };
      document.body.appendChild(el);
    };
    mk({ memoizedProps: {}, child: null, sibling: null });
    mk({ memoizedProps: {}, child: { memoizedProps: { environment: { getStore: () => store } } } });
    expect(await feedOf().install()).toBe('live');
  });

  it('detach uninstalls the bridge, restores notify and ignores an in-flight install', async () => {
    const original = store.notify;
    const feed = feedOf();
    await feed.install();
    expect(store.notify).not.toBe(original);
    feed.detach();
    await flush();
    expect(store.notify).toBe(original);
    expect(w.__igchatRelay).toBeUndefined();
    expect(feed.status).toBe('pending');
    const pendingInstall = feed.install();
    feed.detach();
    await pendingInstall;
    await flush();
    expect(feed.status).toBe('pending');
    expect(store.notify).toBe(original);
  });

  it('does not emit pending when re-installing while live', async () => {
    const feed = feedOf();
    await feed.install();
    const statuses: string[] = [];
    feed.events.on('status', (s) => statuses.push(s));
    await feed.install();
    expect(statuses).toEqual([]);
  });

  it('an invalid snapshot result returns null without changing the status', async () => {
    const feed = feedOf();
    await feed.install();
    page.handler = () => ({ nonsense: true });
    expect(await feed.snapshot()).toBeNull();
    expect(feed.status).toBe('live');
  });

  it('an oversized snapshot is measured in the page, returns null and leaves the status live', async () => {
    const feed = feedOf();
    await feed.install();
    records['mid.$huge'] = { __id: 'mid.$huge', __typename: 'SlideMessage', message_id: 'mid.$huge', blob: 'x'.repeat(8_000_000) };
    expect((0, eval)('window.__igchatRelay.snapshot()')).toEqual({ tooLarge: true });
    expect(await feed.snapshot()).toBeNull();
    expect(feed.status).toBe('live');
  });

  it('a missing bridge makes the snapshot unavailable', async () => {
    const feed = feedOf();
    await feed.install();
    delete w.__igchatRelay;
    expect(await feed.snapshot()).toBeNull();
    expect(feed.status).toBe('unavailable');
  });

  it('a stale install resolving late cannot uninstall a newer bridge', async () => {
    const original = store.notify;
    const feed = feedOf();
    let release: () => void = () => {};
    let first = true;
    page.handler = (script) => {
      const result = (0, eval)(script);
      if (first) {
        first = false;
        return new Promise((r) => (release = () => r('live')));
      }
      return result;
    };
    const a = feed.install(); // A installs in the page but its evaluate has not resolved yet
    await flush();
    feed.detach(); // removes A
    await flush();
    expect(w.__igchatRelay).toBeUndefined();
    expect(await feed.install()).toBe('live'); // B
    const bridgeB = w.__igchatRelay;
    const wrappedB = store.notify;
    release();
    await a;
    await flush();
    expect(w.__igchatRelay).toBe(bridgeB);
    expect(store.notify).toBe(wrappedB);
    expect(store.notify).not.toBe(original);
    expect(feed.status).toBe('live');
  });

  it('detach during an in-flight already-reinstall removes the existing bridge', async () => {
    const original = store.notify;
    const feed = feedOf();
    await feed.install();
    expect(store.notify).not.toBe(original);
    let release: () => void = () => {};
    let first = true;
    page.handler = (script) => {
      const result = (0, eval)(script); // 'already' for the install attempt
      if (first) {
        first = false;
        return new Promise((r) => (release = () => r(result)));
      }
      return result;
    };
    const again = feed.install();
    await flush();
    feed.detach();
    await flush();
    expect(w.__igchatRelay).toBeUndefined();
    expect(store.notify).toBe(original);
    release();
    await again;
    await flush();
    expect(w.__igchatRelay).toBeUndefined();
    expect(feed.status).toBe('pending');
  });

  it('commits earlier chunks and resends the rest when the binding throws partway', async () => {
    vi.useFakeTimers();
    const feed = feedOf();
    await feed.attach();
    await feed.install();
    const got: string[] = [];
    feed.events.on('delta', (d) => got.push(...d.messages.map((m) => (m as Rec).message_id)));
    const emit = w[RELAY_BINDING] as (p: string) => void;
    let calls = 0;
    w[RELAY_BINDING] = (p: string) => {
      if (++calls === 2) throw new Error('binding down');
      emit(p);
    };
    for (const n of [1, 2, 3]) {
      records[`mid.$big${n}`] = { __id: `mid.$big${n}`, __typename: 'SlideMessage', message_id: `mid.$big${n}`, blob: 'x'.repeat(3_000_000) };
    }
    store.notify();
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(got).toEqual(['mid.$big1', 'mid.$big2']);
    store.notify();
    vi.advanceTimersByTime(100);
    expect(got).toEqual(['mid.$big1', 'mid.$big2', 'mid.$big3']);
  });

  it('emits dropped when the count rises', async () => {
    vi.useFakeTimers();
    const feed = feedOf();
    await feed.attach();
    await feed.install();
    const counts: number[] = [];
    feed.events.on('dropped', (n) => counts.push(n));
    records['mid.$huge'] = { __id: 'mid.$huge', __typename: 'SlideMessage', message_id: 'mid.$huge', blob: 'x'.repeat(8_000_000) };
    store.notify();
    vi.advanceTimersByTime(100);
    expect(counts).toEqual([1]);
  });

});

describe('parseRelayPayload', () => {
  it('accepts well-formed deltas', () => {
    expect(parseRelayPayload('{"threads":[],"messages":[{"a":1}],"removed":["x"]}')).toEqual({ threads: [], messages: [{ a: 1 }], removed: ['x'] });
  });

  it('rejects malformed or oversized payloads', () => {
    expect(parseRelayPayload(42)).toBeNull();
    expect(parseRelayPayload('null')).toBeNull();
    expect(parseRelayPayload('[]')).toBeNull();
    expect(parseRelayPayload('{oops')).toBeNull();
    expect(parseRelayPayload('{"threads":[],"messages":{}}')).toBeNull();
    expect(parseRelayPayload('{"threads":[],"messages":[],"removed":[1]}')).toBeNull();
    expect(parseRelayPayload('x'.repeat(MAX_RELAY_PAYLOAD + 1))).toBeNull();
  });
});
