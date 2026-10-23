import { describe, expect, it, vi } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../shared/ipc';
import { ServiceError } from './chatService';
import { Emitter } from './emitter';
import type { EventMap } from '../shared/ipc';
import type { Handlers } from './handlers';
import { forwardEvents, registerIpc, toResult } from './ipc';

describe('toResult', () => {
  it('wraps values', async () => {
    expect(await toResult(() => 5)).toEqual({ ok: true, value: 5 });
    expect(await toResult(async () => 'x')).toEqual({ ok: true, value: 'x' });
  });

  it('maps ServiceError codes and unknown errors', async () => {
    expect(await toResult(() => { throw new ServiceError('RateLimited', 'slow down'); })).toEqual({ ok: false, code: 'RateLimited', message: 'slow down' });
    expect(await toResult(() => { throw new Error('boom'); })).toEqual({ ok: false, code: 'Unknown', message: 'boom' });
  });
});

describe('registerIpc', () => {
  it('registers every channel and forwards arguments', async () => {
    const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void registered.set(channel, fn) };
    const sendText = vi.fn(async (threadId: string, text: string) => ({ threadId, text }));
    const handlers = Object.fromEntries(INVOKE_CHANNELS.map((c) => [c, vi.fn()])) as unknown as Handlers;
    (handlers as unknown as Record<string, unknown>)['msg:sendText'] = sendText;
    registerIpc(ipc as never, handlers);
    expect([...registered.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    const result = await registered.get('msg:sendText')!({}, 't1', 'hi', null);
    expect(sendText).toHaveBeenCalledWith('t1', 'hi', null);
    expect(result).toEqual({ ok: true, value: { threadId: 't1', text: 'hi' } });
  });
});

describe('forwardEvents', () => {
  it('sends every service event to the renderer while it is alive', () => {
    const emitter = new Emitter<EventMap>();
    const send = vi.fn();
    let destroyed = false;
    const off = forwardEvents({ on: (e, fn) => emitter.on(e, fn) }, () => ({ send, isDestroyed: () => destroyed }));
    emitter.emit('msg:removed', 't1', 'm1');
    expect(send).toHaveBeenCalledWith('msg:removed', 't1', 'm1');
    destroyed = true;
    emitter.emit('sync:status', 'ok');
    expect(send).toHaveBeenCalledTimes(1);
    off();
    destroyed = false;
    emitter.emit('sync:status', 'ok');
    expect(send).toHaveBeenCalledTimes(1);
    expect(EVENT_CHANNELS.length).toBe(6);
  });
});
