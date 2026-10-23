import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS, SETTINGS_SYNC_CHANNEL } from './ipc';

describe('ipc contract', () => {
  it('lists every invoke channel exactly once', () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(INVOKE_CHANNELS).toContain('msg:edit');
    expect(INVOKE_CHANNELS).toContain('msg:unsend');
  });

  it('lists every event channel exactly once', () => {
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
    expect(EVENT_CHANNELS).toEqual(['inbox:updated', 'msg:new', 'msg:updated', 'msg:removed', 'sync:status', 'update:status']);
  });

  it('keeps the sync settings channel out of the invoke list', () => {
    expect(INVOKE_CHANNELS as readonly string[]).not.toContain(SETTINGS_SYNC_CHANNEL);
  });
});
