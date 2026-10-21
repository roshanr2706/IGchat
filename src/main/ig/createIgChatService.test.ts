import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EngineState } from '../../shared/types';
import { Emitter } from '../emitter';
import { RELAY_BINDING } from '../engine/relayFeed';
import { FakeCdp, FakePage, flush } from '../engine/testing';
import type { CdpLike, PageLike } from '../engine/types';
import { createIgChatService } from './createIgChatService';

vi.mock('electron', () => ({ BrowserWindow: class {}, session: {}, shell: {}, protocol: {} }));

class FakeEngine {
  readonly events = new Emitter<{ state: (s: EngineState) => void; loaded: () => void; hidden: () => void }>();
  state: EngineState = 'starting';
  needsUserReason: 'login' | 'challenge' = 'login';
  readonly page = new FakePage();
  readonly cdp = new FakeCdp();
  starts = 0;
  stops = 0;
  logouts = 0;
  constructor(private readonly beforeLoad?: (cdp: CdpLike, page: PageLike) => Promise<void>) {}
  async start(): Promise<void> {
    this.starts++;
    await this.beforeLoad?.(this.cdp, this.page);
  }
  stop(): void {
    this.stops++;
  }
  showForUser(): void {}
  async logout(): Promise<void> {
    this.logouts++;
  }
  async navigateToThread(): Promise<void> {}
  async attachImage(): Promise<void> {}
  async isLoggedIn(): Promise<boolean> {
    return true;
  }
  async openUserThread(): Promise<string | null> {
    return null;
  }
  canOpenUserThread(): boolean {
    return true;
  }
  setState(s: EngineState): void {
    this.state = s;
    this.events.emit('state', s);
  }
}

const threadDelta = (title: string) =>
  JSON.stringify({ threads: [{ id: '100', thread_fbid: '100', thread_title: title, users: [], viewer: { id: '1', interop_messaging_user_fbid: '11' } }], messages: [], removed: [] });

function wire(extra: { onLogout?: () => Promise<void> } = {}) {
  let engine!: FakeEngine;
  const dir = mkdtempSync(join(tmpdir(), 'igchat-wire-'));
  const made = createIgChatService({ userDataDir: dir, tmpDir: dir, makeEngine: (o) => (engine = new FakeEngine(o.beforeLoad)), ...extra });
  return { ...made, engine, dir };
}

describe('createIgChatService', () => {
  it('starts the tap and relay binding before Instagram loads, installs the bridge when ready, and feeds deltas to the store', async () => {
    const { service, store, engine } = wire();
    engine.page.handler = () => 'live';
    service.start();
    await flush();
    expect(engine.cdp.sent.map((s) => s.method)).toEqual(expect.arrayContaining(['Network.enable', 'Runtime.enable', 'Runtime.addBinding']));
    engine.setState('ready');
    engine.events.emit('loaded');
    await flush();
    expect(engine.page.scripts.some((s) => s.includes('__igchatRelay'))).toBe(true);
    const updates = vi.fn();
    service.on('inbox:updated', updates);
    engine.cdp.fire('Runtime.bindingCalled', { name: RELAY_BINDING, payload: threadDelta('Live') });
    await flush();
    expect(updates).toHaveBeenCalledWith([expect.objectContaining({ id: '100', title: 'Live' })]);
    expect(store.thread('100')?.title).toBe('Live');
    service.stop();
  });

  it('keeps one relay feed per page: a new document replaces the old feed instead of adding a second', async () => {
    const { service, engine } = wire();
    engine.page.handler = () => 'live';
    service.start();
    await flush();
    // The engine rebuilt its window: beforeLoad runs again on the same CDP stand-in.
    await (engine as unknown as { beforeLoad: (c: CdpLike, p: PageLike) => Promise<void> }).beforeLoad(engine.cdp, engine.page);
    const deltas = vi.spyOn(service, 'applyDelta');
    engine.cdp.fire('Runtime.bindingCalled', { name: RELAY_BINDING, payload: threadDelta('Once') });
    await flush();
    expect(deltas).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('never restarts the engine on its own when it breaks or needs the user', async () => {
    const { service, engine } = wire();
    service.start();
    await flush();
    engine.setState('broken');
    engine.setState('needsUser');
    engine.setState('ready');
    await flush();
    expect(engine.starts).toBe(1);
    expect(engine.stops).toBe(0);
    service.stop();
  });

  it("fills in the people-search id from the page's own module loader, then searches", async () => {
    const { service, engine } = wire();
    engine.page.handler = (script: string) => (script.includes('IGDOmniPickerSearchResultsListQuery_instagramRelayOperation') ? '24681357911' : 'live');
    service.start();
    await flush();
    engine.setState('ready');
    // Exec has no seed id for the search, so the page's loader is asked before anything is sent.
    const search = service.searchPeople('alex').catch(() => {});
    await vi.waitFor(() => expect(engine.page.scripts.some((s) => s.includes('requireLazy'))).toBe(true), { timeout: 3000 });
    service.stop();
    void search;
  });

  it('runs the logout hook (media cache wipe) after the account is logged out', async () => {
    const onLogout = vi.fn(async () => {});
    const { service, engine } = wire({ onLogout });
    service.start();
    await flush();
    await service.logout();
    expect(engine.logouts).toBe(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
    service.stop();
  });
});
