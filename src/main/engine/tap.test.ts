import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocIdRegistry } from './docIds';
import { Tap } from './tap';
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
    request('2', 'https://www.instagram.com/direct/inbox/', undefined, 'GET');
    request('3', 'https://www.instagram.com/api/graphql', body('X', '1', {}));
    cdp.fire('Network.loadingFailed', { requestId: '3' });
    cdp.fire('Network.loadingFinished', { requestId: '2' });
    cdp.fire('Network.loadingFinished', { requestId: '3' });
    await flush();
    expect(seen).not.toHaveBeenCalled();
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
