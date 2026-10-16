import { BrowserWindow, session, shell, type Debugger } from 'electron';
import type { EngineState } from '../../shared/types';
import { ServiceError } from '../chatService';
import { Emitter } from '../emitter';
import { CLICK_SEND_SCRIPT, clickThreadLinkScript, setFileOnPageInput, threadPathFor } from './pageScripts';
import type { CdpLike, EngineLike, PageLike } from './types';
import { classifyEngineUrl } from './urlState';

export const ENGINE_PARTITION = 'persist:ig';
export const ENGINE_START_URL = 'https://www.instagram.com/direct/inbox/';

export function cdpFromDebugger(dbg: Debugger): CdpLike {
  return {
    send: (method, params) => dbg.sendCommand(method, params),
    onEvent: (listener) => {
      const handler = (_event: unknown, method: string, params: unknown): void => listener(method, params);
      dbg.on('message', handler);
      return () => {
        dbg.removeListener('message', handler);
      };
    }
  };
}

type EngineEvents = { state: (s: EngineState) => void; loaded: () => void };
export type EngineOptions = {
  /** Runs once CDP is attached (on about:blank) and before Instagram loads: start the tap and relay binding here. */
  beforeLoad?: (cdp: CdpLike, page: PageLike) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

/** Hidden window running Instagram's own web app. Shown only when Instagram needs the user (login, checkpoints). */
export class EngineWindow implements EngineLike {
  readonly events = new Emitter<EngineEvents>();
  state: EngineState = 'starting';
  needsUserReason: 'login' | 'challenge' = 'login';
  private win: BrowserWindow | null = null;
  private cdpSession: CdpLike | null = null;
  private failures = 0;
  private quitting = false;
  private recovering: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: EngineOptions = {}) {}

  readonly page: PageLike = {
    url: () => this.win?.webContents.getURL() ?? '',
    evaluate: <T>(script: string): Promise<T> =>
      this.win ? (this.win.webContents.executeJavaScript(script, true) as Promise<T>) : Promise.reject(new ServiceError('EngineNotReady', 'Instagram engine is not running'))
  };

  get cdp(): CdpLike {
    if (!this.cdpSession) throw new ServiceError('EngineNotReady', 'Instagram engine is not running');
    return this.cdpSession;
  }

  async start(): Promise<void> {
    if (this.win) return;
    this.quitting = false;
    const ses = session.fromPartition(ENGINE_PARTITION);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 820,
      title: 'Instagram — IGchat',
      autoHideMenuBar: true,
      webPreferences: { partition: ENGINE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    this.win = win;
    const wc = win.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-navigate', () => this.onUrl());
    wc.on('did-navigate-in-page', () => this.onUrl());
    wc.on('did-finish-load', () => {
      this.onUrl();
      this.events.emit('loaded');
    });
    wc.on('render-process-gone', () => this.recover());
    wc.on('unresponsive', () => this.recover());
    // Closing the login window hides it; the engine keeps running.
    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    // CDP's Network.enable hangs on a never-navigated webContents, so attach on about:blank first.
    await wc.loadURL('about:blank');
    wc.debugger.attach('1.3');
    this.cdpSession = cdpFromDebugger(wc.debugger);
    await this.opts.beforeLoad?.(this.cdpSession, this.page);
    await wc.loadURL(ENGINE_START_URL).catch(() => {});
  }

  showForUser(): void {
    if (!this.win) return;
    this.win.show();
    this.win.focus();
  }

  async navigateToThread(threadId: string): Promise<void> {
    if (!this.win || this.state !== 'ready') return;
    const path = threadPathFor(threadId);
    let current = '';
    try {
      current = new URL(this.page.url()).pathname;
    } catch {
      current = '';
    }
    if (current === path) return;
    const clicked = await this.page.evaluate<boolean>(clickThreadLinkScript(threadId)).catch(() => false);
    if (!clicked) await this.win.webContents.loadURL(`https://www.instagram.com${path}`).catch(() => {});
  }

  async attachImage(threadId: string, filePath: string): Promise<void> {
    await this.navigateToThread(threadId);
    await this.sleep(800);
    if (!(await setFileOnPageInput(this.cdp, filePath))) throw new ServiceError('Unknown', "Couldn't find Instagram's attach button");
    await this.sleep(1200);
    // Some Instagram versions send on selection; others show a preview with a Send button.
    await this.page.evaluate<boolean>(CLICK_SEND_SCRIPT).catch(() => false);
  }

  async isLoggedIn(): Promise<boolean> {
    const cookies = await session.fromPartition(ENGINE_PARTITION).cookies.get({ url: 'https://www.instagram.com', name: 'sessionid' });
    return cookies.length > 0;
  }

  async logout(): Promise<void> {
    const ses = session.fromPartition(ENGINE_PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
    this.setState('starting');
    await this.win?.webContents.loadURL(ENGINE_START_URL).catch(() => {});
  }

  stop(): void {
    this.quitting = true;
    if (this.recovering) clearTimeout(this.recovering);
    this.recovering = null;
    this.destroyWindow();
  }

  private onUrl(): void {
    if (!this.win) return;
    const { kind, reason } = classifyEngineUrl(this.page.url());
    if (kind === 'ready') {
      this.failures = 0;
      if (this.win.isVisible()) this.win.hide();
      this.setState('ready');
    } else if (kind === 'needsUser') {
      this.needsUserReason = reason ?? 'login';
      this.setState('needsUser');
      this.showForUser();
    } else if (kind === 'goInbox' || (kind === 'foreign' && this.state !== 'needsUser')) {
      // "Log in with Facebook" may legitimately leave instagram.com while the user is logging in.
      void this.win.webContents.loadURL(ENGINE_START_URL).catch(() => {});
    }
  }

  private setState(s: EngineState): void {
    if (this.state === s) return;
    this.state = s;
    this.events.emit('state', s);
  }

  private recover(): void {
    if (this.recovering || this.quitting) return;
    this.failures++;
    this.setState('broken');
    const delay = Math.min(30_000, 1000 * 2 ** this.failures);
    this.recovering = setTimeout(() => {
      this.recovering = null;
      this.destroyWindow();
      void this.start().catch(() => this.recover());
    }, delay);
  }

  private destroyWindow(): void {
    const win = this.win;
    this.win = null;
    this.cdpSession = null;
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.debugger.detach();
    } catch {
      // already detached
    }
    win.destroy();
  }

  private sleep(ms: number): Promise<void> {
    return this.opts.sleep ? this.opts.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
  }
}
