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
    e1: { __id: 'e1', __typename: 'Edge', node: { __ref: 'm1' }, cursor: 'x' },
    u1: { __id: 'u1', __typename: 'XDTUserDict', id: '9000000001', interop_messaging_user_fbid: '900000000000001', profile_pic_url: 'https://scontent.cdninstagram.com/me.jpg' },
    u2: { __id: 'u2', __typename: 'XDTUserDict', id: '9000000002', username: 'alex_r', interop_messaging_user_fbid: '900000000000002' },
    m1: { __id: 'm1', __typename: 'SlideMessage', id: 'item-1', message_id: 'mid.$m1', thread_fbid: '100', sender_fbid: '900000000000002', timestamp_ms: '1', content_type: 'TEXT', content: { __ref: 'c1' } },
    c1: { __id: 'c1', __typename: 'SlideMessageText', text_body: 'hi' }
  };
}

let records: Record<string, Rec>;
let store: { notify: () => void; getSource: () => { getRecordIDs: () => string[]; get: (id: string) => Rec | undefined } };
let cdp: FakeCdp;
let page: FakePage;

beforeEach(() => {
  records = relayRecords();
  store = { notify: () => {}, getSource: () => ({ getRecordIDs: () => Object.keys(records), get: (id) => records[id] }) };
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
    delete records.m1;
    store.notify();
    vi.advanceTimersByTime(100);
    expect(deltas.mock.calls[1]![0].removed).toEqual(['m1']);
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

describe('parseRelayPayload', () => {
  it('accepts well-formed deltas', () => {
    expect(parseRelayPayload('{"threads":[],"messages":[{"a":1}],"removed":["x"]}')).toEqual({ threads: [], messages: [{ a: 1 }], removed: ['x'] });
  });

  it('rejects malformed or oversized payloads', () => {
    expect(parseRelayPayload(42)).toBeNull();
    expect(parseRelayPayload('{oops')).toBeNull();
    expect(parseRelayPayload('{"threads":[],"messages":{}}')).toBeNull();
    expect(parseRelayPayload('{"threads":[],"messages":[],"removed":[1]}')).toBeNull();
    expect(parseRelayPayload('x'.repeat(MAX_RELAY_PAYLOAD + 1))).toBeNull();
  });
});
