import { Emitter } from '../emitter';
import BRIDGE_SOURCE from './relayBridge.page.js?raw';
import type { CdpLike, PageLike, RelayDelta, RelaySnapshot } from './types';

export const RELAY_BINDING = '__igchatRelayEmit';
export const MAX_RELAY_PAYLOAD = 8_000_000;

export type RelayStatus = 'pending' | 'live' | 'unavailable';
type RelayEvents = { delta: (d: RelayDelta) => void; status: (s: RelayStatus) => void };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function asDelta(v: unknown): RelayDelta | null {
  if (!isObj(v) || !Array.isArray(v.threads) || !Array.isArray(v.messages) || !Array.isArray(v.removed)) return null;
  if (!v.removed.every((x) => typeof x === 'string')) return null;
  return { threads: v.threads, messages: v.messages, removed: v.removed as string[] };
}

/** Validates a binding payload from the page. Untrusted: size-limited and shape-checked. */
export function parseRelayPayload(text: unknown): RelayDelta | null {
  if (typeof text !== 'string' || text.length > MAX_RELAY_PAYLOAD) return null;
  try {
    return asDelta(JSON.parse(text));
  } catch {
    return null;
  }
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
      const delta = parseRelayPayload(params.payload);
      if (delta) this.events.emit('delta', delta);
    });
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Runtime.addBinding', { name: RELAY_BINDING });
  }

  /** Injects the bridge (after every full page load). Retries while the page is still building its store. */
  install(): Promise<RelayStatus> {
    this.installing ??= this.doInstall().finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  private async doInstall(): Promise<RelayStatus> {
    this.setStatus('pending');
    const retries = this.opts.retries ?? 10;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; attempt < retries; attempt++) {
      let result: unknown;
      try {
        result = await this.page.evaluate(`${BRIDGE_SOURCE}(${JSON.stringify(RELAY_BINDING)})`);
      } catch {
        result = 'unavailable';
      }
      if (result === 'live' || result === 'already') {
        this.setStatus('live');
        return 'live';
      }
      if (attempt < retries - 1) await sleep(this.opts.retryDelayMs ?? 1000);
    }
    this.setStatus('unavailable');
    return 'unavailable';
  }

  async snapshot(): Promise<RelaySnapshot | null> {
    if (this.status !== 'live') return null;
    try {
      return parseRelaySnapshot(await this.page.evaluate('window.__igchatRelay ? window.__igchatRelay.snapshot() : null'));
    } catch {
      return null;
    }
  }

  detach(): void {
    this.off?.();
    this.off = null;
  }

  private setStatus(s: RelayStatus): void {
    if (this.status === s && s !== 'pending') return;
    this.status = s;
    this.events.emit('status', s);
  }
}
