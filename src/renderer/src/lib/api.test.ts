import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/settings';
import { call, IgError, initialSettings, on, setBridge } from './api';
import { createFakeBridge } from './fakeBridge';

describe('api', () => {
  it('unwraps successful results', async () => {
    setBridge(createFakeBridge({ 'thread:markSeen': () => undefined, 'msg:unsend': () => undefined }));
    await expect(call('thread:markSeen', 't1')).resolves.toBeUndefined();
  });

  it('throws IgError with the code on failure', async () => {
    setBridge(createFakeBridge({ 'msg:edit': () => { throw new IgError('EditWindowExpired', 'late'); } }));
    const err = await call('msg:edit', 't', 'm', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IgError);
    expect((err as IgError).code).toBe('EditWindowExpired');
  });

  it('reports a missing fake handler as Unknown', async () => {
    setBridge(createFakeBridge({}));
    await expect(call('inbox:get')).rejects.toMatchObject({ code: 'Unknown' });
  });

  it('subscribes to events', () => {
    const bridge = createFakeBridge({});
    setBridge(bridge);
    const fn = vi.fn();
    const off = on('msg:removed', fn);
    bridge.emit('msg:removed', 't1', 'm1');
    off();
    bridge.emit('msg:removed', 't1', 'm2');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('t1', 'm1');
  });

  it('records calls and exposes initial settings', async () => {
    const bridge = createFakeBridge({ 'thread:markSeen': () => undefined });
    setBridge(bridge);
    await call('thread:markSeen', 't9');
    expect(bridge.calls).toEqual([{ channel: 'thread:markSeen', args: ['t9'] }]);
    expect(initialSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
