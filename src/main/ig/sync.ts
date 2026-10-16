import type { ErrorCode } from '../../shared/ipc';
import type { RelayStatus } from '../engine/relayFeed';

export const DOORBELL_MIN_BYTES = 300;
export const DOORBELL_DEBOUNCE_MS = 700;
export const MIN_REFRESH_INTERVAL_MS = 2500;
export const SAFETY_FOCUSED_MS = 60_000;
export const SAFETY_BLURRED_MS = 300_000;
export const BACKOFF_START_MS = 3000;
export const BACKOFF_MAX_MS = 120_000;
export const SAFETY_TICK_MS = 5000;

export type SyncDeps = {
  frames: { on(event: 'socketFrame', fn: (url: string, bytes: number, messaging: boolean) => void): () => void };
  relayStatus: () => RelayStatus;
  engineReady: () => boolean;
  isFocused: () => boolean;
  refresh: () => Promise<void>;
  onError?: (code: ErrorCode) => void;
};

/**
 * Fallback when the relay feed is unavailable: a large frame on a messaging socket rings a "doorbell" that triggers
 * a debounced refresh, plus a slow safety poll. While the relay feed is live, Sync makes no requests at all.
 * Refreshes are single-flight: a doorbell that rings during a refresh queues exactly one follow-up.
 */
export class Sync {
  private off: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the last refresh ran (spaces refreshes MIN_REFRESH_INTERVAL_MS apart). */
  private lastRefresh = 0;
  /** Start of the current quiet period (drives the safety poll). */
  private lastActivity = Date.now();
  private backoffMs = 0;
  private backoffUntil = 0;
  private running = false;
  /** A doorbell rang while a refresh was in flight. */
  private rerun = false;
  /** Bumped by start() and stop(); an in-flight refresh from an older generation is ignored when it settles. */
  private gen = 0;

  constructor(private readonly deps: SyncDeps) {}

  start(): void {
    this.stop();
    this.lastActivity = Date.now();
    this.off = this.deps.frames.on('socketFrame', (_url, bytes, messaging) => {
      if (this.deps.relayStatus() === 'live' || !this.deps.engineReady() || !messaging || bytes < DOORBELL_MIN_BYTES) return;
      this.schedule(DOORBELL_DEBOUNCE_MS);
    });
    this.tick = setInterval(() => this.safetyCheck(), SAFETY_TICK_MS);
  }

  stop(): void {
    this.gen++;
    this.off?.();
    this.off = null;
    if (this.tick) clearInterval(this.tick);
    if (this.timer) clearTimeout(this.timer);
    this.tick = null;
    this.timer = null;
    this.running = false;
    this.rerun = false;
  }

  private safetyCheck(): void {
    if (this.deps.relayStatus() === 'live' || !this.deps.engineReady()) return;
    const limit = this.deps.isFocused() ? SAFETY_FOCUSED_MS : SAFETY_BLURRED_MS;
    if (Date.now() - this.lastActivity >= limit) this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (this.timer) return;
    const now = Date.now();
    const wait = Math.max(delay, this.lastRefresh + MIN_REFRESH_INTERVAL_MS - now, this.backoffUntil - now, 0);
    this.timer = setTimeout(() => void this.run(), wait);
  }

  private async run(): Promise<void> {
    this.timer = null;
    if (this.running || !this.deps.engineReady()) return;
    const gen = this.gen;
    this.running = true;
    this.rerun = false;
    this.lastRefresh = Date.now();
    this.lastActivity = this.lastRefresh;
    try {
      await this.deps.refresh();
      if (gen !== this.gen) return;
      this.backoffMs = 0;
      this.backoffUntil = 0;
    } catch (err) {
      if (gen !== this.gen) return;
      const code = (err as { code?: ErrorCode }).code ?? 'Unknown';
      if (code === 'RateLimited' || code === 'Network') {
        this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
        this.backoffUntil = Date.now() + this.backoffMs;
      }
      this.deps.onError?.(code);
    } finally {
      if (gen === this.gen) {
        this.running = false;
        if (this.rerun) {
          this.rerun = false;
          this.schedule(DOORBELL_DEBOUNCE_MS);
        }
      }
    }
  }
}
