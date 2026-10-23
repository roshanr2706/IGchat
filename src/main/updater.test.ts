import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../shared/ipc';
import { Emitter } from './emitter';
import { Updater, type AutoUpdaterLike } from './updater';

type Events = {
  'checking-for-update': () => void;
  'update-not-available': () => void;
  'update-available': (info: { version: string }) => void;
  'update-downloaded': (info: { version: string }) => void;
  error: (err: Error) => void;
};

function fakeUpdater(): AutoUpdaterLike & { events: Emitter<Events>; checks: number; installs: number } {
  const events = new Emitter<Events>();
  const u = {
    events,
    checks: 0,
    installs: 0,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: (event: keyof Events, fn: Events[keyof Events]) => events.on(event, fn as never),
    checkForUpdates: async () => {
      u.checks++;
      events.emit('checking-for-update');
    },
    quitAndInstall: () => {
      u.installs++;
    }
  };
  return u as never;
}

function setup(enabled = true) {
  const u = fakeUpdater();
  const statuses: UpdateStatus[] = [];
  const beforeInstall = vi.fn();
  const updater = new Updater({ updater: u, current: '0.1.1', enabled: () => enabled, onStatus: (s) => statuses.push(s), beforeInstall, firstCheckMs: 10, intervalMs: 1000 });
  return { u, statuses, beforeInstall, updater };
}

afterEach(() => vi.useRealTimers());

describe('Updater', () => {
  it('is unsupported without an updater (dev builds)', async () => {
    const updater = new Updater({ updater: null, current: '0.1.1', enabled: () => true, onStatus: () => {}, beforeInstall: () => {} });
    expect(updater.get()).toEqual({ state: 'unsupported', current: '0.1.1' });
    expect(await updater.check()).toEqual({ state: 'unsupported', current: '0.1.1' });
  });

  it('downloads in the background and reports ready; install quits only once ready', async () => {
    const { u, statuses, beforeInstall, updater } = setup();
    expect(u.autoDownload).toBe(true);
    expect(u.autoInstallOnAppQuit).toBe(true);
    updater.install();
    expect(u.installs).toBe(0);
    await updater.check();
    u.events.emit('update-available', { version: '0.2.0' });
    u.events.emit('update-downloaded', { version: '0.2.0' });
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'downloading', 'ready']);
    expect(updater.get()).toEqual({ state: 'ready', current: '0.1.1', version: '0.2.0' });
    // A ready update is never checked (and downloaded) again.
    await updater.check();
    expect(u.checks).toBe(1);
    updater.install();
    expect(beforeInstall).toHaveBeenCalledTimes(1);
    expect(u.installs).toBe(1);
  });

  it('reports errors with a short message', async () => {
    const { u, updater } = setup();
    u.checkForUpdates = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED\nstack...'));
    expect(await updater.check()).toEqual({ state: 'error', current: '0.1.1', error: 'net::ERR_INTERNET_DISCONNECTED' });
  });

  it('checks on a timer only while the setting is on', () => {
    vi.useFakeTimers();
    const on = setup(true);
    const off = setup(false);
    on.updater.start();
    off.updater.start();
    vi.advanceTimersByTime(10);
    expect(on.u.checks).toBe(1);
    expect(off.u.checks).toBe(0);
    on.updater.stop();
    off.updater.stop();
  });
});
