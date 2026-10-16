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
/** Doorbell debounce and safety-poll interval vary by +/- this fraction. */
export const JITTER_FRACTION = 0.15;

export type SyncDeps = {
  frames: { on(event: 'socketFrame', fn: (url: string, bytes: number, messaging: boolean) => void): () => void };
  relayStatus: () => RelayStatus;
  engineReady: () => boolean;
  isFocused: () => boolean;
  refresh: () => Promise<void>;
  onError?: (code: ErrorCode) => void;
  /** Returns [0,1); injectable for tests. Defaults to Math.random. */
  random?: () => number;
};

/**
 * Fallback when the relay feed is unavailable: a large frame on a messaging socket rings a "doorbell" that triggers
 * a debounced refresh, plus a slow safety poll. While the relay feed is live, Sync makes no requests at all.
 * Refreshes are single-flight (even across stop()/start()): a doorbell that rings during a refresh queues one follow-up.
 * AuthExpired/Checkpoint pause Sync until the engine reports ready again (or resume() is called).
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
  /** A refresh promise is outstanding; survives stop()/start() so generations never overlap. */
  private running = false;
  /** A doorbell rang while a refresh was in flight. */
  private rerun = false;
  /** AuthExpired/Checkpoint seen: no requests until the engine goes not-ready -> ready, or resume(). */
  private paused = false;
  private wasReady = false;
  private safetyFactor = 1;
  /** Bumped by start() and stop(); an in-flight refresh from an older generation is ignored when it settles. */
  private gen = 0;

  constructor(private readonly deps: SyncDeps) {}

  start(): void {
    this.stop();
    this.lastActivity = Date.now();
    this.wasReady = this.deps.engineReady();
    this.nextSafetyLimit();
    this.off = this.deps.frames.on('socketFrame', (_url, bytes, messaging) => {
      this.observeReady();
      if (this.paused || this.deps.relayStatus() === 'live' || !this.deps.engineReady() || !messaging || bytes < DOORBELL_MIN_BYTES) return;
      this.schedule(this.jitter(DOORBELL_DEBOUNCE_MS));
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
    this.rerun = false;
  }

  /** Lift an auth/checkpoint pause explicitly (an engineReady() false -> true transition also does this). */
  resume(): void {
    this.paused = false;
  }

  private factor(): number {
    return 1 - JITTER_FRACTION + (this.deps.random ?? Math.random)() * 2 * JITTER_FRACTION;
  }

  private jitter(ms: number): number {
    return Math.round(ms * this.factor());
  }

  private nextSafetyLimit(): void {
    this.safetyFactor = this.factor();
  }

  private observeReady(): void {
    const ready = this.deps.engineReady();
    if (ready && !this.wasReady) this.paused = false;
    this.wasReady = ready;
  }

  private safetyCheck(): void {
    this.observeReady();
    if (this.paused || this.deps.relayStatus() === 'live' || !this.deps.engineReady()) return;
    if (Date.now() - this.lastActivity >= Math.round((this.deps.isFocused() ? SAFETY_FOCUSED_MS : SAFETY_BLURRED_MS) * this.safetyFactor)) this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.paused) return;
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
    // Re-check at fire time: the relay may have come up, or auth may have lapsed, since this was scheduled.
    if (this.paused || this.deps.relayStatus() === 'live' || !this.deps.engineReady()) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    const gen = this.gen;
    this.running = true;
    this.rerun = false;
    this.lastRefresh = Date.now();
    this.lastActivity = this.lastRefresh;
    this.nextSafetyLimit();
    try {
      await this.deps.refresh();
      if (gen !== this.gen) return;
      this.backoffMs = 0;
      this.backoffUntil = 0;
    } catch (err) {
      if (gen !== this.gen) return;
      const code = (err as { code?: ErrorCode } | null | undefined)?.code ?? 'Unknown';
      if (code === 'AuthExpired' || code === 'Checkpoint') {
        this.paused = true;
        this.wasReady = this.deps.engineReady();
      } else {
        this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
        this.backoffUntil = Date.now() + this.backoffMs;
      }
      try {
        this.deps.onError?.(code);
      } catch {
        // a throwing listener must not escape as an unhandled rejection
      }
    } finally {
      this.running = false;
      if (this.rerun && this.off) {
        this.rerun = false;
        this.schedule(this.jitter(DOORBELL_DEBOUNCE_MS));
      }
    }
  }
}
