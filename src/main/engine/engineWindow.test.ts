import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Fn = (...args: any[]) => void;
  class Ev {
    private map = new Map<string, Fn[]>();
    on(e: string, f: Fn): this {
      this.map.set(e, [...(this.map.get(e) ?? []), f]);
      return this;
    }
    removeListener(): this {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit(e: string, ...a: any[]): void {
      for (const f of this.map.get(e) ?? []) f(...a);
    }
  }
  class FakeDebugger extends Ev {
    responses = new Map<string, unknown>();
    attach(): void {}
    detach(): void {}
    async sendCommand(method: string): Promise<unknown> {
      return this.responses.get(method) ?? {};
    }
  }
  class FakeWebContents extends Ev {
    url = 'about:blank';
    loads: string[] = [];
    debugger = new FakeDebugger();
    nextUrl: (u: string) => string = (u) => u;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    js: (script: string, wc: FakeWebContents) => any = () => undefined;
    getURL(): string {
      return this.url;
    }
    async loadURL(u: string): Promise<void> {
      this.loads.push(u);
      this.url = this.nextUrl(u);
      this.emit('did-navigate', {}, this.url);
      this.emit('did-finish-load');
    }
    executeJavaScript(script: string): Promise<unknown> {
      return Promise.resolve(this.js(script, this));
    }
    setWindowOpenHandler(): void {}
  }
  class FakeWindow extends Ev {
    webContents = new FakeWebContents();
    shown = 0;
    visible = false;
    constructor() {
      super();
      state.wins.push(this);
      if (state.nextUrl) this.webContents.nextUrl = state.nextUrl;
    }
    show(): void {
      this.shown++;
      this.visible = true;
    }
    hide(): void {
      this.visible = false;
    }
    focus(): void {}
    isVisible(): boolean {
      return this.visible;
    }
    isDestroyed(): boolean {
      return false;
    }
    destroy(): void {}
  }
  const state = { wins: [] as FakeWindow[], cookies: [] as unknown[], nextUrl: null as null | ((u: string) => string) };
  return { FakeWindow, state };
});

vi.mock('electron', () => ({
  BrowserWindow: h.FakeWindow,
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      cookies: { get: async () => h.state.cookies },
      clearStorageData: async () => {},
      clearCache: async () => {}
    })
  },
  shell: { openExternal: () => {} }
}));

import { EngineWindow, ENGINE_START_URL } from './engineWindow';
import { flush } from './testing';

const INBOX = ENGINE_START_URL;
const instant = async (): Promise<void> => {};
const win = (): InstanceType<typeof h.FakeWindow> => h.state.wins.at(-1)!;

beforeEach(() => {
  h.state.wins.length = 0;
  h.state.cookies = [];
  h.state.nextUrl = null;
});

async function readyEngine(): Promise<EngineWindow> {
  const e = new EngineWindow({ sleep: instant });
  await e.start();
  expect(e.state).toBe('ready');
  return e;
}

describe('EngineWindow redirect recovery', () => {
  it('reloads the inbox a few times, then hands the window to the user', async () => {
    h.state.nextUrl = (u) => (u === INBOX ? 'https://www.instagram.com/' : u);
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    await vi.waitFor(() => expect(e.state).toBe('needsUser'));
    expect(e.needsUserReason).toBe('challenge');
    expect(win().shown).toBeGreaterThan(0);
    expect(win().webContents.loads.filter((u) => u === INBOX)).toHaveLength(4);
  });

  it('does not bounce the user while they are mid-flow', async () => {
    h.state.nextUrl = (u) => (u === INBOX ? 'https://www.instagram.com/accounts/login/' : u);
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    expect(e.state).toBe('needsUser');
    const wc = win().webContents;
    wc.url = 'https://www.instagram.com/accounts/password/reset/';
    wc.emit('did-navigate', {}, wc.url);
    await flush();
    expect(wc.loads).toEqual(['about:blank', INBOX]);
  });

  it('only announces loaded for real pages, not about:blank', async () => {
    const e = new EngineWindow({ sleep: instant });
    const loaded = vi.fn();
    e.events.on('loaded', loaded);
    await e.start();
    expect(loaded).toHaveBeenCalledTimes(1);
  });
});

describe('EngineWindow lifecycle', () => {
  it('shares one in-flight start between concurrent callers', async () => {
    const e = new EngineWindow({ sleep: instant });
    await Promise.all([e.start(), e.start()]);
    expect(h.state.wins).toHaveLength(1);
  });

  it('rejects start cleanly when stopped mid-start', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const e = new EngineWindow({ sleep: instant, beforeLoad: () => gate });
    const started = e.start();
    await flush();
    e.stop();
    release();
    await expect(started).rejects.toMatchObject({ code: 'EngineNotReady' });
  });

  it('logout on a stopped engine emits no state change', async () => {
    const e = new EngineWindow({ sleep: instant });
    const state = vi.fn();
    e.events.on('state', state);
    await e.logout();
    expect(state).not.toHaveBeenCalled();
    expect(e.state).toBe('starting');
  });
});

describe('EngineWindow thread navigation', () => {
  it('refuses when the engine is not ready', async () => {
    const e = new EngineWindow({ sleep: instant });
    await expect(e.navigateToThread('222')).rejects.toMatchObject({ code: 'EngineNotReady' });
    await expect(e.attachImage('222', 'x')).rejects.toMatchObject({ code: 'EngineNotReady' });
  });

  it('resolves once the page url is the thread', async () => {
    const e = await readyEngine();
    win().webContents.js = (script, wc) => {
      wc.url = 'https://www.instagram.com/direct/t/222/';
      return script.includes('222');
    };
    await expect(e.navigateToThread('222')).resolves.toBeUndefined();
  });

  it('throws when the page never reaches the thread', async () => {
    const e = await readyEngine();
    win().webContents.js = () => false;
    win().webContents.nextUrl = () => INBOX;
    await expect(e.navigateToThread('222')).rejects.toMatchObject({ code: 'Unknown' });
  });

  it('throws when no send button is found after attaching', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.debugger.responses.set('DOM.getDocument', { root: { nodeId: 1 } });
    wc.debugger.responses.set('DOM.querySelectorAll', { nodeIds: [4] });
    wc.js = (script, w) => {
      if (script.includes('input[type="file"]')) return false;
      w.url = 'https://www.instagram.com/direct/t/222/';
      return true;
    };
    await expect(e.attachImage('222', 'x')).rejects.toMatchObject({ code: 'Unknown' });
  });
});
