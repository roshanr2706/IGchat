import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocIdRegistry } from './docIds';
import { MAX_PENDING, Tap } from './tap';
import { FakeCdp, flush } from './testing';

const body = (name: string, docId: string, variables: unknown) =>
  `av=1&__user=0&fb_dtsg=DTSG&lsd=LSD&jazoest=2&fb_api_caller_class=RelayModern&fb_api_req_friendly_name=${name}&variables=${encodeURIComponent(JSON.stringify(variables))}&server_timestamps=true&doc_id=${docId}`;

let cdp: FakeCdp;
let docIds: DocIdRegistry;
let tap: Tap;

beforeEach(async () => {
  cdp = new FakeCdp();
  docIds = new DocIdRegistry();
  tap = new Tap(cdp, docIds);
  await tap.start();
});

const request = (id: string, url: string, postData?: string, method = 'POST') =>
  cdp.fire('Network.requestWillBeSent', { requestId: id, request: { url, method, postData, headers: { 'X-IG-App-ID': '936', 'X-FB-LSD': 'LSD' } } });

describe('Tap', () => {
  it('enables the network domain', () => {
    expect(cdp.sent[0]).toMatchObject({ method: 'Network.enable' });
  });

  it('emits observations for the page GraphQL calls and learns doc ids and the envelope', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    request('1', 'https://www.instagram.com/api/graphql', body('IGDMessageListOffMsysQuery', '999', { id: '100' }));
    cdp.bodies.set('1', { body: 'for (;;);{"data":{"x":1}}', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: '1' });
    await flush();
    expect(seen).toHaveBeenCalledWith({ name: 'IGDMessageListOffMsysQuery', docId: '999', variables: { id: '100' }, data: { x: 1 } });
    expect(docIds.get('IGDMessageListOffMsysQuery')).toBe('999');
    expect(tap.envelope?.form.fb_dtsg).toBe('DTSG');
    expect(tap.envelope?.headers['X-IG-App-ID']).toBe('936');
  });

  it('ignores non-GraphQL and GET requests, and failed loads', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    cdp.bodies.set('2', { body: '{"data":{"a":1}}', base64Encoded: false });
    cdp.bodies.set('3', { body: '{"data":{"a":1}}', base64Encoded: false });
    request('2', 'https://www.instagram.com/direct/inbox/', undefined, 'GET');
    request('3', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.fire('Network.loadingFailed', { requestId: '3' });
    cdp.fire('Network.loadingFinished', { requestId: '2' });
    cdp.fire('Network.loadingFinished', { requestId: '3' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
    expect(cdp.sent.filter((s) => s.method === 'Network.getResponseBody')).toHaveLength(0);
  });

  it('ignores a getResponseBody rejection', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    request('4', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.fire('Network.loadingFinished', { requestId: '4' });
    await flush();
    expect(cdp.sent.some((s) => s.method === 'Network.getResponseBody')).toBe(true);
    expect(seen).not.toHaveBeenCalled();
  });

  it('decodes base64-encoded bodies', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    request('5', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.bodies.set('5', { body: Buffer.from('{"data":{"y":2}}').toString('base64'), base64Encoded: true });
    cdp.fire('Network.loadingFinished', { requestId: '5' });
    await flush();
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ data: { y: 2 } }));
  });

  it('ignores loadingFinished for an unseen id', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    cdp.fire('Network.loadingFinished', { requestId: 'nope' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
    expect(cdp.sent.filter((s) => s.method === 'Network.getResponseBody')).toHaveLength(0);
  });

  it('ignores a malformed body', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    request('6', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.bodies.set('6', { body: '<html>not json</html>', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: '6' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
  });

  it('ignores a POST with no postData', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    request('7', 'https://www.instagram.com/api/graphql', undefined);
    cdp.bodies.set('7', { body: '{"data":{}}', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: '7' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
  });

  it('falls back to Network.getRequestPostData when postData is omitted', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    cdp.responses.set('Network.getRequestPostData', { postData: body('IGDMessageListOffMsysQuery', '77', { id: '1' }) });
    cdp.fire('Network.requestWillBeSent', { requestId: '8', request: { url: 'https://www.instagram.com/api/graphql', method: 'POST', hasPostData: true, headers: {} } });
    cdp.bodies.set('8', { body: '{"data":{"z":3}}', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: '8' });
    await flush();
    expect(cdp.sent.some((s) => s.method === 'Network.getRequestPostData' && s.params?.requestId === '8')).toBe(true);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ name: 'IGDMessageListOffMsysQuery', docId: '77', data: { z: 3 } }));
  });

  it('handles a getRequestPostData failure quietly', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    const orig = cdp.send.bind(cdp);
    cdp.send = (async (m: string, p?: Record<string, unknown>) => {
      if (m === 'Network.getRequestPostData') throw new Error('gone');
      return orig(m, p);
    }) as typeof cdp.send;
    cdp.fire('Network.requestWillBeSent', { requestId: '10', request: { url: 'https://www.instagram.com/api/graphql', method: 'POST', hasPostData: true, headers: {} } });
    cdp.bodies.set('10', { body: '{"data":{}}', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: '10' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
  });

  it('discards in-flight body reads after stop()', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    let release: (v: any) => void = () => {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const orig = cdp.send.bind(cdp);
    cdp.send = (async (m: string, p?: Record<string, unknown>) => {
      if (m === 'Network.getResponseBody') return new Promise((r) => (release = r));
      return orig(m, p);
    }) as typeof cdp.send;
    request('11', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.fire('Network.loadingFinished', { requestId: '11' });
    await flush();
    tap.stop();
    release({ body: '{"data":{"late":1}}', base64Encoded: false });
    await flush();
    expect(seen).not.toHaveBeenCalled();
  });

  it('does not scrape doc ids from script reads that finish after stop()', async () => {
    let release: (v: any) => void = () => {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const orig = cdp.send.bind(cdp);
    cdp.send = (async (m: string, p?: Record<string, unknown>) => {
      if (m === 'Network.getResponseBody') return new Promise((r) => (release = r));
      return orig(m, p);
    }) as typeof cdp.send;
    cdp.fire('Network.responseReceived', { requestId: 's2', type: 'Script' });
    cdp.fire('Network.loadingFinished', { requestId: 's2' });
    await flush();
    tap.stop();
    release({ body: '"IGDirectEditMessageMutation_instagramRelayOperation",x,e.exports="555"', base64Encoded: false });
    await flush();
    expect(docIds.get('IGDirectEditMessageMutation')).not.toBe('555');
  });

  it('cleans up websocket state on close', () => {
    const frames = vi.fn();
    tap.events.on('socketFrame', frames);
    cdp.fire('Network.webSocketCreated', { requestId: 'w1', url: 'wss://gateway.instagram.com/ws/lightspeed' });
    cdp.fire('Network.webSocketClosed', { requestId: 'w1' });
    cdp.fire('Network.webSocketFrameReceived', { requestId: 'w1', response: { opcode: 1, payloadData: 'hi' } });
    expect(frames).toHaveBeenCalledWith('', 2, false);
  });

  it('does not let a doc id match cross into the next module', async () => {
    cdp.fire('Network.responseReceived', { requestId: 's3', type: 'Script' });
    cdp.bodies.set('s3', {
      body: '__d("IGDirectEditMessageMutation_instagramRelayOperation",[],(function(){}),null);__d("Other",[],(function(e){e.exports="999"}),null);',
      base64Encoded: false
    });
    cdp.fire('Network.loadingFinished', { requestId: 's3' });
    await flush();
    expect(docIds.get('IGDirectEditMessageMutation')).not.toBe('999');
  });

  it('drops the oldest pending requests beyond the cap', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    for (let i = 0; i < MAX_PENDING + 1; i++) request(`p${i}`, 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    await flush();
    cdp.bodies.set('p0', { body: '{"data":{}}', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: 'p0' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
  });

  it('detaches its listener when Network.enable rejects', async () => {
    const c = new FakeCdp();
    c.send = (async () => {
      throw new Error('boom');
    }) as typeof c.send;
    const t = new Tap(c, new DocIdRegistry());
    await expect(t.start()).rejects.toThrow('boom');
    const frames = vi.fn();
    t.events.on('socketFrame', frames);
    c.fire('Network.webSocketFrameReceived', { requestId: 'a', response: { opcode: 1, payloadData: 'hi' } });
    expect(frames).not.toHaveBeenCalled();
  });

  it('scrapes doc ids from loaded scripts', async () => {
    cdp.fire('Network.responseReceived', { requestId: 's1', type: 'Script' });
    cdp.bodies.set('s1', { body: '__d("IGDirectEditMessageMutation_instagramRelayOperation",[],(function(a,b,c,d,e,f){e.exports="123456"}),null);', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: 's1' });
    await flush();
    expect(docIds.get('IGDirectEditMessageMutation')).toBe('123456');
  });

  it('reports websocket frame sizes and whether the socket carries messaging', () => {
    const frames = vi.fn();
    tap.events.on('socketFrame', frames);
    cdp.fire('Network.webSocketCreated', { requestId: 'w1', url: 'wss://gateway.instagram.com/ws/lightspeed?x=1' });
    cdp.fire('Network.webSocketCreated', { requestId: 'w2', url: 'wss://gateway.instagram.com/ws/streamcontroller' });
    cdp.fire('Network.webSocketFrameReceived', { requestId: 'w1', response: { opcode: 2, payloadData: 'A'.repeat(400) } });
    cdp.fire('Network.webSocketFrameReceived', { requestId: 'w2', response: { opcode: 1, payloadData: 'hi' } });
    expect(frames).toHaveBeenNthCalledWith(1, 'wss://gateway.instagram.com/ws/lightspeed?x=1', 300, true);
    expect(frames).toHaveBeenNthCalledWith(2, 'wss://gateway.instagram.com/ws/streamcontroller', 2, false);
  });

  it('stops listening after stop()', async () => {
    const seen = vi.fn();
    tap.events.on('observation', seen);
    tap.stop();
    request('9', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.bodies.set('9', { body: '{"data":{}}', base64Encoded: false });
    cdp.fire('Network.loadingFinished', { requestId: '9' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
  });
});
