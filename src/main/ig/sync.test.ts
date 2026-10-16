import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../chatService';
import { Emitter } from '../emitter';
import type { TapEvents } from '../engine/tap';
import { Sync, type SyncDeps } from './sync';

const MESSAGING = 'wss://gateway.instagram.com/ws/lightspeed';
let frames: Emitter<TapEvents>;
let relay: 'pending' | 'live' | 'unavailable';
let ready: boolean;
let focused: boolean;
let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
let sync: Sync;
let listeners = 0;

const counted = (): SyncDeps['frames'] => ({
  on: (event, fn) => {
    listeners++;
    const off = frames.on(event, fn);
    return () => {
      listeners--;
      off();
    };
  }
});
const mk = (extra: Partial<SyncDeps> = {}) =>
  new Sync({ frames: counted(), relayStatus: () => relay, engineReady: () => ready, isFocused: () => focused, refresh: () => refresh(), random: () => 0.5, ...extra });

const ring = (bytes = 500, messaging = true) => frames.emit('socketFrame', MESSAGING, bytes, messaging);

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Emitter<TapEvents>();
  relay = 'unavailable';
  ready = true;
  focused = true;
  listeners = 0;
  refresh = vi.fn(async () => {});
  sync = mk();
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
    await vi.advanceTimersByTimeAsync(239_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('backs off after rate limiting and reports the error', async () => {
    const errors: string[] = [];
    sync.stop();
    refresh = vi.fn(async () => {
      throw new ServiceError('RateLimited', 'slow down');
    });
    sync = mk({ onError: (c) => errors.push(c) });
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

  it('start() twice keeps exactly one listener', async () => {
    expect(listeners).toBe(1);
    sync.start();
    expect(listeners).toBe(1);
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
    sync.stop();
    expect(listeners).toBe(0);
  });

  it('keeps retrying after Network errors with backoff', async () => {
    sync.stop();
    refresh = vi.fn(async () => {
      throw new ServiceError('Network', 'down');
    });
    sync = mk();
    sync.start();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('Sync fix round', () => {
  let fail: unknown = null;

  const failWith = (code: string) => {
    refresh.mockImplementation(async () => {
      throw new ServiceError(code as ServiceError['code'], 'x');
    });
  };

  it('drops a scheduled run if the relay went live before the timer fired', async () => {
    ring();
    relay = 'live';
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops the queued rerun if the relay went live during the refresh', async () => {
    let release!: () => void;
    refresh.mockImplementation(() => new Promise<void>((r) => (release = r)));
    ring();
    await vi.advanceTimersByTimeAsync(700);
    ring();
    relay = 'live';
    release();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['AuthExpired', 'Checkpoint'])('%s pauses sync until the engine reports ready again', async (code) => {
    const errors: string[] = [];
    sync.stop();
    sync = mk({ onError: (c) => errors.push(c) });
    sync.start();
    failWith(code);
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([code]);
    ring();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    // engine goes down and comes back
    ready = false;
    await vi.advanceTimersByTimeAsync(5000);
    ready = true;
    refresh.mockImplementation(async () => {});
    await vi.advanceTimersByTimeAsync(5001);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('resume() lifts a pause', async () => {
    failWith('AuthExpired');
    ring();
    await vi.advanceTimersByTimeAsync(700);
    refresh.mockImplementation(async () => {});
    sync.resume();
    ring();
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  const gaps = async (steps: number) => {
    const times: number[] = [];
    refresh.mockImplementation(async () => {
      times.push(Date.now());
      if (fail) throw fail;
    });
    for (let i = 0; i < steps; i++) {
      ring();
      await vi.advanceTimersByTimeAsync(1000);
    }
    return times.slice(1).map((t, i) => t - times[i]);
  };

  it.each(['RateLimited', 'Network', 'Unknown'])('%s backoff doubles from 3 s, caps at 120 s, resets on success', async (code) => {
    fail = new ServiceError(code as ServiceError['code'], 'x');
    const g = await gaps(700);
    const expected = [3000, 6000, 12_000, 24_000, 48_000, 96_000, 120_000, 120_000];
    expected.forEach((b, i) => {
      expect(g[i]).toBeGreaterThanOrEqual(b);
      expect(g[i]).toBeLessThanOrEqual(b + 1000);
    });
    // a success resets the backoff
    fail = null;
    await gaps(130);
    fail = new ServiceError(code as ServiceError['code'], 'x');
    const after = await gaps(40);
    fail = null;
    expect(after[0]).toBeGreaterThanOrEqual(3000);
    expect(after[0]).toBeLessThanOrEqual(4000);
    expect(after[1]).toBeGreaterThanOrEqual(6000);
    expect(after[1]).toBeLessThanOrEqual(7000);
  });

  it('null/undefined rejections and a throwing onError do not escape', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    sync.stop();
    sync = mk({
      onError: () => {
        throw new Error('listener');
      }
    });
    sync.start();
    refresh.mockImplementation(() => Promise.reject(undefined));
    ring();
    await vi.advanceTimersByTimeAsync(700);
    refresh.mockImplementation(() => Promise.reject(null));
    ring();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('stop() then start() while a refresh is in flight never overlaps refreshes', async () => {
    let active = 0;
    let max = 0;
    const releases: Array<() => void> = [];
    refresh.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          active++;
          max = Math.max(max, active);
          releases.push(() => {
            active--;
            resolve();
          });
        })
    );
    ring();
    await vi.advanceTimersByTimeAsync(700);
    expect(refresh).toHaveBeenCalledTimes(1);
    sync.stop();
    sync.start();
    ring();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    releases[0]();
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(2);
    releases[1]();
    expect(max).toBe(1);
  });

  it('jitters the doorbell debounce and the safety poll', async () => {
    sync.stop();
    sync = mk({ random: () => 0 });
    sync.start();
    ring();
    await vi.advanceTimersByTimeAsync(594);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // safety limit is 51 s at random 0: nothing before it, a refresh by the next tick after
    await vi.advanceTimersByTimeAsync(49_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    sync.stop();
    refresh.mockClear();
    sync = mk({ random: () => 1 });
    sync.start();
    ring();
    await vi.advanceTimersByTimeAsync(804);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
