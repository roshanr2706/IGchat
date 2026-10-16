import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../chatService';
import { Emitter } from '../emitter';
import type { TapEvents } from '../engine/tap';
import { Sync } from './sync';

const MESSAGING = 'wss://gateway.instagram.com/ws/lightspeed';
let frames: Emitter<TapEvents>;
let relay: 'pending' | 'live' | 'unavailable';
let ready: boolean;
let focused: boolean;
let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
let sync: Sync;

const ring = (bytes = 500, messaging = true) => frames.emit('socketFrame', MESSAGING, bytes, messaging);

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Emitter<TapEvents>();
  relay = 'unavailable';
  ready = true;
  focused = true;
  refresh = vi.fn(async () => {});
  sync = new Sync({ frames, relayStatus: () => relay, engineReady: () => ready, isFocused: () => focused, refresh });
  sync.start();
});

afterEach(() => {
  sync.stop();
  vi.useRealTimers();
});

describe('Sync fallback', () => {
  it('makes no requests while the relay feed is live', async () => {
    relay = 'live';
    ring();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once, debounced, after a burst of large messaging frames', async () => {
    ring();
    ring();
    ring();
    await vi.advanceTimersByTimeAsync(699);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores small and non-messaging frames, and frames while the engine is not ready', async () => {
    ring(100);
    ring(5000, false);
    ready = false;
    ring();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps refreshes at least 2.5 s apart', async () => {
    ring();
    await vi.advanceTimersByTimeAsync(700);
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1800);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('runs a safety refresh after 60 s focused or 5 min blurred without activity', async () => {
    await vi.advanceTimersByTimeAsync(60_001);
    expect(refresh).toHaveBeenCalledTimes(1);
    focused = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(245_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('backs off after rate limiting and reports the error', async () => {
    const errors: string[] = [];
    sync.stop();
    refresh = vi.fn(async () => {
      throw new ServiceError('RateLimited', 'slow down');
    });
    sync = new Sync({ frames, relayStatus: () => relay, engineReady: () => ready, isFocused: () => focused, refresh, onError: (c) => errors.push(c) });
    sync.start();
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
    ring();
    await vi.advanceTimersByTimeAsync(2900);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(['RateLimited', 'RateLimited']);
  });
});

describe('Sync hardening', () => {
  it('never runs two refreshes at once (single-flight), then follows up once', async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          release = () => {
            active--;
            resolve();
          };
        })
    );
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
    ring();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(2);
    release();
    expect(maxActive).toBe(1);
  });

  it('does not follow up after stop() while a refresh is in flight', async () => {
    let release!: () => void;
    refresh.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    ring();
    await vi.advanceTimersByTimeAsync(700);
    ring();
    sync.stop();
    release();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('start() twice does not double up listeners', async () => {
    sync.start();
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying after Network errors with backoff', async () => {
    sync.stop();
    refresh = vi.fn(async () => {
      throw new ServiceError('Network', 'down');
    });
    sync = new Sync({ frames, relayStatus: () => relay, engineReady: () => ready, isFocused: () => focused, refresh });
    sync.start();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(refresh).toHaveBeenCalledTimes(1);
    // after failure: backoff 3 s; safety needs another 60 s of quiet from the failed run
    await vi.advanceTimersByTimeAsync(65_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
