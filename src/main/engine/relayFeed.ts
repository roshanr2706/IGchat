import { Emitter } from '../emitter';
import BRIDGE_SOURCE from './relayBridge.page.js?raw';
import type { CdpLike, PageLike, RelayDelta, RelaySnapshot } from './types';

export const RELAY_BINDING = '__igchatRelayEmit';
export const MAX_RELAY_PAYLOAD = 8_000_000;

export type RelayStatus = 'pending' | 'live' | 'unavailable';
type RelayEvents = { delta: (d: RelayDelta) => void; status: (s: RelayStatus) => void; dropped: (count: number) => void };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function asDelta(v: unknown): RelayDelta | null {
  if (!isObj(v) || !Array.isArray(v.threads) || !Array.isArray(v.messages) || !Array.isArray(v.removed)) return null;
  if (!v.removed.every((x) => typeof x === 'string')) return null;
  return { threads: v.threads, messages: v.messages, removed: v.removed as string[] };
}

function parseRaw(text: unknown): { delta: RelayDelta; dropped: number } | null {
  if (typeof text !== 'string' || text.length > MAX_RELAY_PAYLOAD) return null;
  try {
    const raw: unknown = JSON.parse(text);
    const delta = asDelta(raw);
    if (!delta || !isObj(raw)) return null;
    const d = raw.dropped;
    return { delta, dropped: typeof d === 'number' && Number.isFinite(d) && d >= 0 ? Math.floor(d) : 0 };
  } catch {
    return null;
  }
}

/** Validates a binding payload from the page. Untrusted: size-limited and shape-checked. */
export function parseRelayPayload(text: unknown): RelayDelta | null {
  return parseRaw(text)?.delta ?? null;
}

export function parseRelaySnapshot(value: unknown): RelaySnapshot | null {
  const delta = asDelta(value);
  if (!delta || !isObj(value)) return null;
  const inbox = isObj(value.inbox) ? value.inbox : {};
  return {
    ...delta,
    viewer: isObj(value.viewer) ? value.viewer : {},
    inbox: { endCursor: typeof inbox.endCursor === 'string' ? inbox.endCursor : null, hasMore: inbox.hasMore === true }
  };
}

/** Live feed of Instagram's in-page Relay store. */
export class RelayFeed {
  readonly events = new Emitter<RelayEvents>();
  status: RelayStatus = 'pending';
  /** How many records the page had to skip (too large to send). A count only; never any data. */
  dropped = 0;
  private generation = 0;
  private tokenSeq = 0;
  private off: (() => void) | null = null;
  private installing: Promise<RelayStatus> | null = null;

  constructor(
    private readonly cdp: CdpLike,
    private readonly page: PageLike,
    private readonly opts: { retries?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
  ) {}

  /** Registers the binding the bridge calls. Survives page reloads; call once per CDP session. */
  async attach(): Promise<void> {
    this.off?.();
    this.off = this.cdp.onEvent((method, params) => {
      if (method !== 'Runtime.bindingCalled' || params?.name !== RELAY_BINDING) return;
      const parsed = parseRaw(params.payload);
      if (!parsed) return;
      const rose = parsed.dropped > this.dropped;
      this.dropped = parsed.dropped;
      if (rose) this.events.emit('dropped', parsed.dropped);
      this.events.emit('delta', parsed.delta);
    });
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Runtime.addBinding', { name: RELAY_BINDING });
  }

  /** Injects the bridge (after every full page load). Retries while the page is still building its store. */
  install(): Promise<RelayStatus> {
    if (!this.installing) {
      const p: Promise<RelayStatus> = this.doInstall().finally(() => {
        if (this.installing === p) this.installing = null;
      });
      this.installing = p;
    }
    return this.installing;
  }

  private async doInstall(): Promise<RelayStatus> {
    const gen = this.generation;
    const token = `${Date.now().toString(36)}-${++this.tokenSeq}-${Math.random().toString(36).slice(2)}`;
    if (this.status !== 'live') this.setStatus('pending');
    const retries = this.opts.retries ?? 10;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; attempt < retries; attempt++) {
      if (gen !== this.generation) return this.status;
      let result: unknown;
      try {
        result = await this.page.evaluate(`${BRIDGE_SOURCE}(${JSON.stringify(RELAY_BINDING)}, ${JSON.stringify(token)})`);
      } catch {
        result = 'unavailable';
      }
      if (gen !== this.generation) {
        // Detached while this attempt was in flight: take back whatever it installed.
        if (result === 'live') this.uninstallInPage(token);
        return this.status;
      }
      if (result === 'live') this.dropped = 0;
      if (result === 'live' || result === 'already') {
        this.setStatus('live');
        return 'live';
      }
      if (attempt < retries - 1) await sleep(this.opts.retryDelayMs ?? 1000);
    }
    if (gen !== this.generation) return this.status;
    this.setStatus('unavailable');
    return 'unavailable';
  }

  async snapshot(): Promise<RelaySnapshot | null> {
    if (this.status !== 'live') return null;
    try {
      const raw = await this.page.evaluate('window.__igchatRelay ? window.__igchatRelay.snapshot() : null');
      if (raw === null || raw === undefined) {
        // The bridge is gone (for example after a reload).
        this.setStatus('unavailable');
        return null;
      }
      // Too large, page-side error or invalid: no snapshot, but the live feed itself is unaffected.
      if ((JSON.stringify(raw)?.length ?? 0) > MAX_RELAY_PAYLOAD) return null;
      return parseRelaySnapshot(raw);
    } catch {
      return null;
    }
  }

  detach(): void {
    this.off?.();
    this.off = null;
    this.generation++;
    this.installing = null;
    this.uninstallInPage(null);
    this.setStatus('pending');
  }

  /** Best effort: restores the page's original notify and stops its timers. */
  /** With a token: removes only that install (stale attempts). With null: removes whatever bridge is present (detach). */
  private uninstallInPage(token: string | null): void {
    try {
      const script = `window.__igchatRelay && window.__igchatRelay.uninstall && window.__igchatRelay.uninstall(${JSON.stringify(token)})`;
      void Promise.resolve(this.page.evaluate(script)).catch(() => {});
    } catch {
      // ignore
    }
  }

  private setStatus(s: RelayStatus): void {
    if (this.status === s && s !== 'pending') return;
    this.status = s;
    this.events.emit('status', s);
  }
}
