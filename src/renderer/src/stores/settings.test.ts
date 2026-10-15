import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import { setBridge } from '../lib/api';
import { createFakeBridge } from '../lib/fakeBridge';
import { settings } from './settings.svelte';

type Pending = { patch: Partial<Settings>; resolve: (value: Settings) => void };

let pending: Pending[];

beforeEach(() => {
  pending = [];
  setBridge(
    createFakeBridge({
      'settings:set': (patch) =>
        new Promise<Settings>((resolve) => {
          pending.push({ patch, resolve });
        })
    })
  );
  settings.init(DEFAULT_SETTINGS);
});

describe('settings store', () => {
  it('ignores a stale response when updates overlap', async () => {
    const a = settings.update({ themeId: 'nord' });
    const b = settings.update({ compact: true });
    await vi.waitFor(() => expect(pending).toHaveLength(2));

    // A's response reflects only A. B's optimistic change must survive it.
    pending[0].resolve(sanitizeSettings({ ...DEFAULT_SETTINGS, themeId: 'nord', compact: false }));
    await a;
    expect(settings.value.compact).toBe(true);
    expect(settings.value.themeId).toBe('nord');

    // B's response is the latest and carries the full canonical state.
    pending[1].resolve(sanitizeSettings({ ...DEFAULT_SETTINGS, themeId: 'nord', compact: true }));
    await b;
    expect(settings.value.themeId).toBe('nord');
    expect(settings.value.compact).toBe(true);
  });
});
