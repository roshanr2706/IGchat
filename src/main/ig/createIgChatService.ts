import { join } from 'node:path';
import { DocIdRegistry } from '../engine/docIds';
import { EngineWindow, type EngineOptions } from '../engine/engineWindow';
import { Exec } from '../engine/exec';
import { RelayFeed } from '../engine/relayFeed';
import { Tap } from '../engine/tap';
import type { EngineLike, PageLike } from '../engine/types';
import { AccountCache } from './cache';
import { IgChatService, type RelayLike } from './service';
import { IgStore } from './store';
import { Sync } from './sync';

type WiredEngine = EngineLike & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly events: { on(event: 'state' | 'loaded' | 'hidden', fn: (...args: any[]) => void): () => void };
  readonly page: PageLike;
};

export type CreateOptions = {
  userDataDir: string;
  tmpDir: string;
  /** Extra per-account cleanup after logout, such as wiping the media cache. */
  onLogout?: () => Promise<void>;
  /** Test seam; production uses EngineWindow. */
  makeEngine?: (opts: EngineOptions) => WiredEngine;
};

/** Builds the Instagram backend: engine window -> tap/relay/exec -> store -> service, plus fallback sync. */
export function createIgChatService(opts: CreateOptions): { service: IgChatService; store: IgStore } {
  const docIds = new DocIdRegistry();
  const store = new IgStore();
  let tap: Tap | null = null;
  let relay: RelayFeed | null = null;
  let sync: Sync | null = null;
  // `service` and `engine` are assigned below; these callbacks only run after start().
  let service: IgChatService;

  // Runs once per engine window (each has its own CDP session), before Instagram loads.
  const beforeLoad: EngineOptions['beforeLoad'] = async (cdp, page) => {
    sync?.stop();
    tap?.stop();
    // Exactly one relay feed per page: the old one must let go before the new one binds.
    relay?.detach();
    const newTap = new Tap(cdp, docIds);
    tap = newTap;
    await newTap.start();
    newTap.events.on('observation', (o) => service.applyObservation(o));
    const newRelay = new RelayFeed(cdp, page);
    relay = newRelay;
    newRelay.events.on('delta', (d) => void service.applyDelta(d));
    await newRelay.attach();
    sync = new Sync({
      frames: newTap.events,
      relayStatus: () => newRelay.status,
      engineReady: () => engine.state === 'ready',
      isFocused: () => service.isFocused,
      refresh: () => service.refresh()
    });
    sync.start();
  };

  const engine: WiredEngine = opts.makeEngine ? opts.makeEngine({ beforeLoad }) : new EngineWindow({ beforeLoad });
  const installRelay = (): void => {
    if (engine.state === 'ready') void relay?.install();
  };
  engine.events.on('state', installRelay);
  engine.events.on('loaded', installRelay);
  // Sync pauses on AuthExpired/Checkpoint; it resumes once the engine is ready again or the user closes the
  // login window (they may have just cleared the step). Never restart the engine itself from here.
  engine.events.on('state', (s: string) => {
    if (s === 'ready') sync?.resume();
  });
  engine.events.on('hidden', () => sync?.resume());

  const relayProxy: RelayLike = {
    get status() {
      return relay?.status ?? 'pending';
    },
    snapshot: () => relay?.snapshot() ?? Promise.resolve(null)
  };
  const exec = new Exec(
    engine.page,
    {
      get envelope() {
        return tap?.envelope ?? null;
      }
    },
    docIds
  );
  service = new IgChatService({
    engine,
    relay: relayProxy,
    exec,
    store,
    cache: new AccountCache(join(opts.userDataDir, 'accounts', 'default')),
    tmpDir: opts.tmpDir,
    onLogout: opts.onLogout
  });
  return { service, store };
}
