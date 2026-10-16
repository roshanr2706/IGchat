import { beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../chatService';
import { DocIdRegistry } from './docIds';
import { Exec } from './exec';
import { parseForm } from './graphql';
import { FakePage } from './testing';
import type { Envelope } from './types';

const envelope: Envelope = { form: { fb_dtsg: 'DTSG', lsd: 'LSD', av: '1' }, headers: { 'X-IG-App-ID': '936' } };
let page: FakePage;
let tap: { envelope: Envelope | null };
let exec: Exec;
let sleeps: number[];

/** Pulls the request object back out of the generated fetch script. */
const requestOf = (script: string) => JSON.parse(script.slice(script.lastIndexOf('})(') + 3, -1)) as { path: string; body: string; headers: Record<string, string> };

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
    await expect(exec.run('IGDirectTextSendMutation', {})).rejects.toBeInstanceOf(ServiceError);
  });

  it('fails with EngineNotReady for unknown operations or when no envelope arrives', async () => {
    await expect(exec.run('NoSuchOperation', {})).rejects.toMatchObject({ code: 'EngineNotReady' });
    tap.envelope = null;
    const quick = new Exec(page, tap, new DocIdRegistry(), { envelopeWaitMs: 1000, jitterMs: () => 0, sleep: async () => {} });
    await expect(quick.run('IGDirectTextSendMutation', {})).rejects.toMatchObject({ code: 'EngineNotReady' });
    expect(page.scripts).toHaveLength(0);
  });
});
