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
    sent: string[] = [];
    async sendCommand(method: string): Promise<unknown> {
      this.sent.push(method);
      return this.responses.get(method) ?? {};
    }
  }
  class FakeWebContents extends Ev {
    url = 'about:blank';
    loads: string[] = [];
    debugger = new FakeDebugger();
    nextUrl: (u: string) => string = (u) => u;
    onLoaded: (u: string, wc: FakeWebContents) => void = () => {};
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
      this.onLoaded(u, this);
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
      if (state.onLoaded) this.webContents.onLoaded = state.onLoaded;
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
  const state = { wins: [] as FakeWindow[], opened: [] as string[], cookies: [] as unknown[], nextUrl: null as null | ((u: string) => string), onLoaded: null as null | ((u: string, wc: FakeWebContents) => void) };
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
  shell: { openExternal: (u: string) => h.state.opened.push(u) }
}));

import { EngineWindow, ENGINE_START_URL } from './engineWindow';
import { flush } from './testing';

const INBOX = ENGINE_START_URL;
const instant = async (): Promise<void> => {};
const win = (): InstanceType<typeof h.FakeWindow> => h.state.wins.at(-1)!;

beforeEach(() => {
  h.state.wins.length = 0;
  h.state.cookies = [];
  h.state.opened.length = 0;
  h.state.nextUrl = null;
  h.state.onLoaded = null;
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

  it('resolves even when no send button is found after the file is handed over', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.debugger.responses.set('DOM.getDocument', { root: { nodeId: 1 } });
    wc.debugger.responses.set('DOM.querySelectorAll', { nodeIds: [4] });
    wc.js = (script, w) => {
      if (script.includes('input[type="file"]')) return false;
      w.url = 'https://www.instagram.com/direct/t/222/';
      return true;
    };
    await expect(e.attachImage('222', 'x')).resolves.toBeUndefined();
    expect(wc.debugger.sent).toContain('DOM.setFileInputFiles');
  });

  it('still throws before the handoff when there is no file input', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.debugger.responses.set('DOM.getDocument', { root: { nodeId: 1 } });
    wc.debugger.responses.set('DOM.querySelectorAll', { nodeIds: [] });
    wc.js = (_s, w) => {
      w.url = 'https://www.instagram.com/direct/t/222/';
      return true;
    };
    await expect(e.attachImage('222', 'x')).rejects.toMatchObject({ code: 'Unknown' });
  });
});

describe('EngineWindow opening a DM with a person', () => {
  const DM = 'https://www.instagram.com/direct/t/1000000000000333/';
  const BY_USER = 'https://www.instagram.com/direct/t/9000000002/';

  it('opens /direct/t/<user id>/, follows the redirect to the existing thread, and does not reload the inbox', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.loads.length = 0;
    wc.nextUrl = (u) => (u === BY_USER ? BY_USER : u);
    wc.onLoaded = (u, w) => {
      if (u === BY_USER) {
        w.url = DM;
        w.emit('did-navigate', {}, DM);
      }
    };
    await expect(e.openUserThread('9000000002')).resolves.toBe('1000000000000333');
    await flush();
    expect(wc.loads).toEqual([BY_USER]);
    expect(e.state).toBe('ready');
  });

  it('treats a page that stays on /direct/t/<user id>/ as a brand-new conversation', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.loads.length = 0;
    wc.nextUrl = (u) => (u === BY_USER ? BY_USER : u);
    await expect(e.openUserThread('9000000002')).resolves.toBe('9000000002');
    expect(wc.loads).toEqual([BY_USER]);
  });

  it('rejects anything that is not a numeric user id, without loading anything', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.loads.length = 0;
    for (const bad of ['', 'alex', '12', '1/2', '../123', '123?x=1', '1'.repeat(26), '123%2F4']) await expect(e.openUserThread(bad)).resolves.toBeNull();
    expect(wc.loads).toEqual([]);
  });

  it('returns null when the engine is not ready or never reaches a thread', async () => {
    const idle = new EngineWindow({ sleep: instant });
    await expect(idle.openUserThread('9000000002')).resolves.toBeNull();
    const e = await readyEngine();
    const wc = win().webContents;
    wc.loads.length = 0;
    wc.nextUrl = (u) => (u === INBOX ? INBOX : 'https://www.instagram.com/');
    await expect(e.openUserThread('9000000002')).resolves.toBeNull();
    // Exactly one explicit recovery load; the window stays hidden and the engine stays ready.
    expect(wc.loads).toEqual([BY_USER, INBOX]);
    expect(win().shown).toBe(0);
    expect(e.state).toBe('ready');
    await flush();
    expect(wc.loads).toHaveLength(2);
  });

  it('refuses without hopping once the person-open budget is spent, and never hands over', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.nextUrl = (u) => (u === INBOX ? INBOX : 'https://www.instagram.com/');
    for (let i = 0; i < 5; i++) await expect(e.openUserThread('9000000002')).resolves.toBeNull();
    expect(e.canOpenUserThread()).toBe(false);
    wc.loads.length = 0;
    await expect(e.openUserThread('9000000002')).resolves.toBeNull();
    expect(wc.loads).toEqual([]);
    expect(win().shown).toBe(0);
    expect(e.state).toBe('ready');
  });

  it('recovers by loading the inbox when the page ends up somewhere that is not a conversation', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.loads.length = 0;
    wc.nextUrl = (u) => (u === INBOX ? INBOX : 'https://www.instagram.com/m/someone/');
    await expect(e.openUserThread('9000000002')).resolves.toBeNull();
    expect(wc.loads).toEqual([BY_USER, INBOX]);
    expect(win().shown).toBe(0);
    expect(e.state).toBe('ready');
  });

  it('hands over to the user and reports AuthExpired when the hop hits a login wall', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.loads.length = 0;
    wc.nextUrl = () => 'https://www.instagram.com/accounts/login/';
    await expect(e.openUserThread('9000000002')).rejects.toMatchObject({ code: 'AuthExpired' });
    expect(e.state).toBe('needsUser');
    expect(win().visible).toBe(true);
    expect(wc.loads).toEqual([BY_USER]);
  });

  it('does not mistake the thread it was already on for the result', async () => {
    const e = await readyEngine();
    const wc = win().webContents;
    wc.url = DM;
    wc.nextUrl = () => DM;
    wc.loadURL = async () => {
      throw new Error('ERR_ABORTED');
    };
    await expect(e.openUserThread('9000000002')).resolves.toBeNull();
  });
});

describe('EngineWindow handover to the user', () => {
  const LOGIN = 'https://www.instagram.com/accounts/login/';
  const nav = async (url: string): Promise<void> => {
    const wc = win().webContents;
    wc.url = url;
    wc.emit('did-navigate', {}, url);
    await flush();
    await flush();
  };

  it('does not bounce a needsUser account page even with a session cookie', async () => {
    h.state.nextUrl = (u) => (u === INBOX ? LOGIN : u);
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    h.state.cookies = [{}];
    await nav('https://www.instagram.com/accounts/password/change/');
    expect(win().webContents.loads).toEqual(['about:blank', INBOX]);
    expect(e.state).toBe('needsUser');
  });

  it('sends the post-login landing page back to the inbox', async () => {
    h.state.nextUrl = (u) => (u === INBOX ? LOGIN : u);
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    h.state.cookies = [{}];
    win().webContents.nextUrl = (u) => u;
    await nav('https://www.instagram.com/?next=x');
    await vi.waitFor(() => expect(e.state).toBe('ready'));
    expect(win().webContents.loads.filter((u) => u === INBOX)).toHaveLength(2);
  });

  it('stays hands-off after giving up, even long afterwards', async () => {
    h.state.nextUrl = (u) => (u === INBOX ? 'https://www.instagram.com/' : u);
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    await vi.waitFor(() => expect(e.state).toBe('needsUser'));
    const loads = win().webContents.loads.length;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 70_000);
    h.state.cookies = [{}];
    await nav('https://www.instagram.com/explore/');
    await nav('https://www.instagram.com/');
    spy.mockRestore();
    expect(win().webContents.loads).toHaveLength(loads);
  });
});

describe('EngineWindow resuming after an auth step', () => {
  const LOOP = (u: string): string => (u === INBOX ? 'https://www.instagram.com/' : u);
  const nav = async (url: string): Promise<void> => {
    const wc = win().webContents;
    wc.url = url;
    wc.emit('did-navigate', {}, url);
    await flush();
    await flush();
  };
  const giveUp = async (): Promise<EngineWindow> => {
    h.state.nextUrl = LOOP;
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    await vi.waitFor(() => expect(e.state).toBe('needsUser'));
    return e;
  };

  it('resumes when the user clears a checkpoint after a give-up', async () => {
    const e = await giveUp();
    await nav('https://www.instagram.com/challenge/x/');
    const before = win().webContents.loads.filter((u) => u === INBOX).length;
    h.state.cookies = [{}];
    win().webContents.nextUrl = (u) => u;
    await nav('https://www.instagram.com/');
    await vi.waitFor(() => expect(e.state).toBe('ready'));
    expect(win().webContents.loads.filter((u) => u === INBOX).length - before).toBe(1);
  });

  it('resumes when the user returns from Facebook login after a give-up', async () => {
    const e = await giveUp();
    await nav('https://www.facebook.com/login');
    const before = win().webContents.loads.length;
    h.state.cookies = [{}];
    win().webContents.nextUrl = (u) => u;
    await nav('https://www.instagram.com/');
    await vi.waitFor(() => expect(e.state).toBe('ready'));
    expect(win().webContents.loads.length - before).toBe(1);
  });

  it('forgets the handover when the window is rebuilt', async () => {
    const e = await giveUp();
    e.stop();
    await e.start();
    await vi.waitFor(() => expect(win().webContents.loads.filter((u) => u === INBOX).length).toBeGreaterThanOrEqual(4));
  });
});

describe('EngineWindow guards', () => {
  const event = () => ({ preventDefault: vi.fn() });

  it('blocks navigation to foreign hosts and opens https ones externally', async () => {
    await readyEngine();
    win().visible = true;
    const ev = event();
    win().webContents.emit('will-navigate', ev, 'https://evil.example/x');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(h.state.opened).toEqual(['https://evil.example/x']);
    const ok = event();
    win().webContents.emit('will-navigate', ok, 'https://www.instagram.com/direct/t/1/');
    expect(ok.preventDefault).not.toHaveBeenCalled();
  });

  it('does not open links externally while the window is hidden', async () => {
    await readyEngine();
    expect(win().visible).toBe(false);
    const ev = event();
    win().webContents.emit('will-navigate', ev, 'https://evil.example/x');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(h.state.opened).toEqual([]);
  });

  it('cancels foreign redirects without opening them', async () => {
    await readyEngine();
    const ev = event();
    win().webContents.emit('will-redirect', ev, 'https://evil.example/x');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(h.state.opened).toEqual([]);
  });

  it('recovers when the debugger detaches', async () => {
    const e = await readyEngine();
    win().webContents.debugger.emit('detach');
    expect(e.state).toBe('broken');
    expect(() => e.cdp).toThrow();
    e.stop();
  });

  it('gives an unresponsive page time to come back before recovering', async () => {
    const e = await readyEngine();
    vi.useFakeTimers();
    try {
      win().webContents.emit('unresponsive');
      win().webContents.emit('responsive');
      vi.advanceTimersByTime(11_000);
      expect(e.state).toBe('ready');
      win().webContents.emit('unresponsive');
      vi.advanceTimersByTime(11_000);
      expect(e.state).toBe('broken');
    } finally {
      e.stop();
      vi.useRealTimers();
    }
  });
});

describe('EngineWindow hard cap on automatic reloads', () => {
  const CHALLENGE = 'https://www.instagram.com/challenge/x/';
  const settle = async (e: EngineWindow): Promise<number> => {
    await vi.waitFor(() => expect(e.state).toBe('needsUser'));
    for (let i = 0; i < 5; i++) await flush();
    const count = (): number => win().webContents.loads.filter((u) => u === INBOX).length;
    const before = count();
    for (let i = 0; i < 5; i++) await flush();
    expect(count()).toBe(before);
    return before;
  };
  const landOnRoot = (wc: { url: string; emit(e: string, ...a: unknown[]): void }): void => {
    wc.url = 'https://www.instagram.com/';
    wc.emit('did-navigate', {}, wc.url);
  };

  it('stops an inbox -> challenge -> / loop', async () => {
    h.state.cookies = [{}];
    h.state.nextUrl = (u) => (u === INBOX ? CHALLENGE : u);
    h.state.onLoaded = (u, wc) => {
      if (u === INBOX) landOnRoot(wc);
    };
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    expect(await settle(e)).toBeLessThanOrEqual(7);
    expect(win().shown).toBeGreaterThan(0);
    e.stop();
  });

  it('stops an inbox -> facebook -> / loop', async () => {
    h.state.cookies = [{}];
    h.state.nextUrl = (u) => (u === INBOX ? 'https://www.facebook.com/login' : u);
    h.state.onLoaded = (u, wc) => {
      if (u === INBOX) landOnRoot(wc);
    };
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    expect(await settle(e)).toBeLessThanOrEqual(7);
    e.stop();
  });

  it('stops a briefly ready inbox that immediately goes to /', async () => {
    h.state.cookies = [{}];
    h.state.onLoaded = (u, wc) => {
      if (u === INBOX) landOnRoot(wc);
    };
    const e = new EngineWindow({ sleep: instant });
    await e.start();
    expect(await settle(e)).toBeLessThanOrEqual(7);
    e.stop();
  });
});
