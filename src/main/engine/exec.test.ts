import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../chatService';
import { DocIdRegistry } from './docIds';
import { Exec, fetchScript } from './exec';
import { parseForm } from './graphql';
import { FakePage } from './testing';
import type { Envelope } from './types';

const envelope: Envelope = { form: { fb_dtsg: 'DTSG', lsd: 'LSD', av: '1' }, headers: { 'X-IG-App-ID': '936' } };
let page: FakePage;
let tap: { envelope: Envelope | null };
let exec: Exec;
let sleeps: number[];

/** Pulls the request object back out of the generated fetch script. */
const requestOf = (script: string) => JSON.parse(script.slice(script.indexOf('})({"path":') + 3, -1)) as { path: string; body: string; headers: Record<string, string> };

beforeEach(() => {
  page = new FakePage();
  tap = { envelope };
  sleeps = [];
  exec = new Exec(page, tap, new DocIdRegistry(), { jitterMs: () => 200, sleep: async (ms) => void sleeps.push(ms) });
  page.handler = () => ({ status: 200, url: 'https://www.instagram.com/api/graphql', text: '{"data":{"ok":true}}' });
});

describe('Exec', () => {
  it('runs the operation inside the page with the page envelope and returns data', async () => {
    await expect(exec.run('IGDirectTextSendMutation', { a: 1 })).resolves.toEqual({ ok: true });
    const req = requestOf(page.scripts[0]!);
    expect(req.path).toBe('/api/graphql');
    expect(parseForm(req.body)).toMatchObject({ fb_dtsg: 'DTSG', doc_id: '26911679871773184', fb_api_req_friendly_name: 'IGDirectTextSendMutation', variables: '{"a":1}' });
    expect(req.headers['X-IG-App-ID']).toBe('936');
    expect(page.scripts[0]).toContain("credentials: 'include'");
    expect(sleeps).toContain(200);
  });

  it('serializes concurrent calls', async () => {
    let active = 0;
    let maxActive = 0;
    page.handler = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { status: 200, url: '', text: '{"data":{}}' };
    };
    await Promise.all([exec.run('IGDirectTextSendMutation', {}), exec.run('IGDirectTextSendMutation', {}), exec.run('IGDirectTextSendMutation', {})]);
    expect(maxActive).toBe(1);
  });

  it('maps a login redirect to AuthExpired and keeps working afterwards', async () => {
    page.handler = () => ({ status: 200, url: 'https://www.instagram.com/accounts/login/?next=%2F', text: '<html>' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'AuthExpired' });
    page.handler = () => ({ status: 200, url: '', text: '{"data":{"x":1}}' });
    await expect(exec.run('IGDirectTextSendMutation', {})).resolves.toEqual({ x: 1 });
  });

  it('maps network failures, GraphQL errors and unreadable bodies', async () => {
    page.handler = () => ({ status: 0, url: '', text: 'TypeError: Failed to fetch' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'Network' });
    page.handler = () => ({ status: 200, url: '', text: '{"errors":[{"message":"bad"}]}' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'Unknown' });
    page.handler = () => ({ status: 200, url: '', text: 'not json' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'Unknown' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toBeInstanceOf(ServiceError);
  });

  it('maps rate limiting and challenge redirects', async () => {
    page.handler = () => ({ status: 429, url: '', text: '{}' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'RateLimited' });
    page.handler = () => ({ status: 200, url: 'https://www.instagram.com/challenge/abc/', text: '<html>' });
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'Checkpoint' });
  });

  it('round-trips hostile variables exactly through the generated script', async () => {
    const hostile = { t: ['q"\\', "'", '`', '</script>', String.fromCharCode(0x2028), String.fromCharCode(0x2029), '${x}', '})(', '\n'].join('') };
    await exec.run('IGDirectTextSendMutation', hostile);
    const req = requestOf(page.scripts[0]!);
    expect(JSON.parse(parseForm(req.body).variables!)).toEqual(hostile);
  });

  it('increments __req across calls', async () => {
    await exec.run('IGDirectTextSendMutation', {});
    await exec.run('IGDirectTextSendMutation', {});
    const a = parseInt(parseForm(requestOf(page.scripts[0]!).body).__req!, 36);
    const b = parseInt(parseForm(requestOf(page.scripts[1]!).body).__req!, 36);
    expect(b).toBe(a + 1);
  });

  it('maps an evaluate rejection to a ServiceError', async () => {
    page.handler = () => {
      throw new Error('Object has been destroyed');
    };
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'EngineNotReady' });
  });

  it('times out a hung evaluate and keeps the queue moving', async () => {
    const fast = new Exec(page, tap, new DocIdRegistry(), { fetchTimeoutMs: 20, jitterMs: () => 0, sleep: async () => {} });
    page.handler = () => new Promise(() => {});
    await expect(fast.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'Network' });
    page.handler = () => ({ status: 200, url: '', text: '{"data":{"ok":1}}' });
    await expect(fast.run('IGDirectTextSendMutation', {})).resolves.toEqual({ ok: 1 });
  });

  it('marks failures that may follow an issued request as ambiguous, and definite ones as not', async () => {
    const run = () => exec.run('IGDirectTextSendMutation', {}).catch((e: ServiceError) => e);
    page.handler = () => ({ status: 0, url: '', text: 'AbortError' });
    expect(await run()).toMatchObject({ code: 'Network', ambiguous: true });
    page.handler = () => {
      throw new Error('Object has been destroyed');
    };
    expect(await run()).toMatchObject({ code: 'EngineNotReady', ambiguous: true });
    page.handler = () => ({ status: 200, url: '', text: 'not json' });
    expect(await run()).toMatchObject({ code: 'Unknown', ambiguous: true });
    const fast = new Exec(page, tap, new DocIdRegistry(), { fetchTimeoutMs: 20, jitterMs: () => 0, sleep: async () => {} });
    page.handler = () => new Promise(() => {});
    expect(await fast.run('IGDirectTextSendMutation', {}).catch((e: ServiceError) => e)).toMatchObject({ code: 'Network', ambiguous: true });
    for (const status of [502, 503, 504]) {
      page.handler = () => ({ status, url: '', text: '{}' });
      expect(await run()).toMatchObject({ code: 'Network', ambiguous: true });
    }
    for (const [status, url, text] of [[500, '', '{}'], [501, '', '{}'], [429, '', '{}'], [400, '', '{}'], [403, '', '{}'], [200, 'https://www.instagram.com/accounts/login/', '<html>'], [200, '', '{"errors":[{"message":"bad"}]}']] as const) {
      page.handler = () => ({ status, url, text });
      expect(((await run()) as ServiceError).ambiguous).toBe(false);
    }
  });

  it('treats failures before any request is issued as definite', async () => {
    const unknownOp = await exec.run('NoSuchOperation', {}).catch((e: ServiceError) => e);
    expect(unknownOp).toMatchObject({ code: 'EngineNotReady', ambiguous: false });
    tap.envelope = null;
    const quick = new Exec(page, tap, new DocIdRegistry(), { envelopeWaitMs: 500, jitterMs: () => 0, sleep: async () => {} });
    expect(await quick.run('IGDirectTextSendMutation', {}).catch((e: ServiceError) => e)).toMatchObject({ ambiguous: false });
  });

  it('fails with EngineNotReady for unknown operations or when no envelope arrives', async () => {
    await expect(exec.run('NoSuchOperation', {})).rejects.toMatchObject({ code: 'EngineNotReady' });
    tap.envelope = null;
    const quick = new Exec(page, tap, new DocIdRegistry(), { envelopeWaitMs: 1000, jitterMs: () => 0, sleep: async () => {} });
    await expect(quick.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'EngineNotReady' });
    expect(page.scripts).toHaveLength(0);
  });
});

describe('Exec REST reads', () => {
  it("sends a same-origin GET shaped like the page's own, and unwraps the payload", async () => {
    tap.envelope = { form: { fb_dtsg: 'DTSG', lsd: 'LSD', __d: 'www', __user: '0', __comet_req: '7', jazoest: '123', __crn: 'comet.igweb.Route' }, headers: { 'X-IG-App-ID': '936', 'X-FB-LSD': 'LSD', 'X-CSRFToken': 'csrf' } };
    page.handler = () => ({ status: 200, url: 'https://www.instagram.com/api/v1/direct_v2/ranked_recipients/', text: 'for (;;);{"payload":{"ranked_recipients":[]}}' });
    expect(await exec.get('/api/v1/direct_v2/ranked_recipients/', { mode: 'universal', query: 'al ex', show_threads: 'true' })).toEqual({ ranked_recipients: [] });
    const req = requestOf(page.scripts[0]!);
    expect(page.scripts[0]).toContain("method: 'GET'");
    const url = new URL(req.path, 'https://www.instagram.com');
    expect(url.pathname).toBe('/api/v1/direct_v2/ranked_recipients/');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ mode: 'universal', query: 'al ex', show_threads: 'true', __d: 'www', __user: '0', __a: '1', __comet_req: '7', jazoest: '123', __crn: 'comet.igweb.Route' });
    // POST-only tokens stay out of the URL; the page's headers go along, minus the GraphQL-only LSD one.
    expect(url.searchParams.has('fb_dtsg')).toBe(false);
    expect(url.searchParams.has('lsd')).toBe(false);
    expect(req.headers).toEqual({ 'X-Requested-With': 'XMLHttpRequest', 'X-IG-App-ID': '936', 'X-CSRFToken': 'csrf' });
  });

  it('classifies REST failures like GraphQL ones and refuses paths outside /api/v1', async () => {
    page.handler = () => ({ status: 400, url: 'https://www.instagram.com/api/v1/x/', text: '{"message":"login_required","status":"fail"}' });
    await expect(exec.get('/api/v1/direct_v2/ranked_recipients/', { query: 'a' })).rejects.toMatchObject({ code: 'AuthExpired' });
    await expect(exec.get('https://evil.example/api/v1/x/', {})).rejects.toBeInstanceOf(ServiceError);
    await expect(exec.get('/api/v1/../../x/', {})).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('fetchScript GET token', () => {
  it("adds the page's own async GET token inside the page, never passing it through main", async () => {
    const calls: string[] = [];
    const w = window as unknown as Record<string, unknown>;
    w.require = (n: string) => (n === 'DTSGInitData' ? { async_get_token: 'TOK:EN' } : undefined);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return { status: 200, url, text: async () => '{}' };
    }) as unknown as typeof fetch;
    try {
      const script = fetchScript({ path: '/api/v1/x/?a=1', body: '', headers: {}, method: 'GET' });
      expect(script).not.toContain('TOK');
      await (0, eval)(script);
      expect(calls).toEqual(['/api/v1/x/?a=1&fb_dtsg_ag=TOK%3AEN']);
    } finally {
      globalThis.fetch = realFetch;
      w.require = undefined;
    }
  });
});
