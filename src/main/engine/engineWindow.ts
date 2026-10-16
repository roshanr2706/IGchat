import { BrowserWindow, session, shell, type Debugger } from 'electron';
import type { EngineState } from '../../shared/types';
import { ServiceError } from '../chatService';
import { Emitter } from '../emitter';
import { CLICK_SEND_SCRIPT, clickThreadLinkScript, pathMatchesThread, setFileOnPageInput, threadPathFor, waitForThreadUrl } from './pageScripts';
import type { CdpLike, EngineLike, PageLike } from './types';
import { classifyEngineUrl, isAllowedNavigation, RedirectPolicy } from './urlState';

export const ENGINE_PARTITION = 'persist:ig';
export const ENGINE_START_URL = 'https://www.instagram.com/direct/inbox/';

const THREAD_NAV_TIMEOUT_MS = 8000;
const RESPONSIVE_GRACE_MS = 10_000;

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

const notRunning = (): ServiceError => new ServiceError('EngineNotReady', 'Instagram engine is not running');

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
  private unresponsive: ReturnType<typeof setTimeout> | null = null;
  private starting: Promise<void> | null = null;
  private redirecting = false;
  /** Set once the user has been (or must be) given the window; no automatic redirects until a ready page clears it. */
  private handedOver = false;
  /** Set when redirect recovery gave up; even the post-login bounce stays off until a ready page. */
  private gaveUp = false;
  private curUrl = '';
  private prevUrl = '';
  private readonly redirects = new RedirectPolicy();

  constructor(private readonly opts: EngineOptions = {}) {}

  readonly page: PageLike = {
    url: () => this.win?.webContents.getURL() ?? '',
    // executeJavaScript awaits a returned promise and rejects if the page script throws.
    evaluate: <T>(script: string): Promise<T> => (this.win ? (this.win.webContents.executeJavaScript(script, true) as Promise<T>) : Promise.reject(notRunning()))
  };

  get cdp(): CdpLike {
    if (!this.cdpSession) throw notRunning();
    return this.cdpSession;
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.win) return Promise.resolve();
    const p = this.doStart().finally(() => {
      if (this.starting === p) this.starting = null;
    });
    this.starting = p;
    return p;
  }

  private async doStart(): Promise<void> {
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
    this.handedOver = false;
    this.gaveUp = false;
    this.prevUrl = '';
    this.curUrl = '';
    this.redirects.reset();
    const wc = win.webContents;
    // Never open new windows; https links go to the user's browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    // The window may only travel within Instagram and the Facebook/Meta hosts used for login and checkpoints.
    const guard = (event: { preventDefault(): void }, url: string): void => {
      if (isAllowedNavigation(url)) return;
      event.preventDefault();
      // Only hand a link to the browser when the user is looking at this window and so probably clicked it.
      if (!win.isVisible()) return;
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    };
    wc.on('will-navigate', guard);
    // Redirects are only cancelled; the user didn't click anything, so nothing is opened externally.
    wc.on('will-redirect', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });
    wc.on('did-navigate', () => this.onUrl());
    wc.on('did-navigate-in-page', () => this.onUrl());
    wc.on('did-finish-load', () => {
      const url = this.page.url();
      if (url === '' || url === 'about:blank') return;
      this.onUrl();
      this.events.emit('loaded');
    });
    wc.on('render-process-gone', () => this.recover());
    wc.on('unresponsive', () => {
      if (this.unresponsive || this.quitting) return;
      this.unresponsive = setTimeout(() => {
        this.unresponsive = null;
        this.recover();
      }, RESPONSIVE_GRACE_MS);
    });
    wc.on('responsive', () => this.clearUnresponsive());
    wc.debugger.on('detach', () => {
      if (this.win !== win) return;
      this.cdpSession = null;
      if (!this.quitting) this.recover();
    });
    // Closing the login window hides it; the engine keeps running.
    win.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    try {
      // CDP's Network.enable hangs on a never-navigated webContents, so attach on about:blank first.
      await wc.loadURL('about:blank');
      if (this.win !== win) throw notRunning();
      wc.debugger.attach('1.3');
      this.cdpSession = cdpFromDebugger(wc.debugger);
      await this.opts.beforeLoad?.(this.cdpSession, this.page);
      if (this.win !== win) throw notRunning();
      await wc.loadURL(ENGINE_START_URL).catch(() => {});
    } catch (err) {
      // stop() during start() tears the window down under us; report that cleanly.
      if (this.win !== win) throw notRunning();
      throw err;
    }
  }

  showForUser(): void {
    if (!this.win) return;
    this.win.show();
    this.win.focus();
  }

  async navigateToThread(threadId: string): Promise<void> {
    const win = this.win;
    if (!win || this.state !== 'ready') throw notRunning();
    if (pathMatchesThread(this.page.url(), threadId)) return;
    const clicked = await this.page.evaluate<boolean>(clickThreadLinkScript(threadId)).catch(() => false);
    if (!clicked) await win.webContents.loadURL(`https://www.instagram.com${threadPathFor(threadId)}`).catch(() => {});
    if (!(await waitForThreadUrl(() => this.page.url(), threadId, (ms) => this.sleep(ms), THREAD_NAV_TIMEOUT_MS))) {
      throw new ServiceError('Unknown', "Instagram didn't open the conversation");
    }
  }

  async attachImage(threadId: string, filePath: string): Promise<void> {
    await this.navigateToThread(threadId);
    await this.sleep(800);
    if (!(await setFileOnPageInput(this.cdp, filePath))) throw new ServiceError('Unknown', "Couldn't find Instagram's attach button");
    await this.sleep(1200);
    // The file is handed over: from here nothing may throw a retryable error, or the caller would send the image twice.
    // Some Instagram versions send on selection; others show a preview with a Send button. If we can't click one,
    // the caller waits for the echo to decide whether the image went out.
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
    // A stopped engine has nothing to restart; don't announce a state change that isn't happening.
    const win = this.win;
    if (!win) return;
    this.setState('starting');
    await win.webContents.loadURL(ENGINE_START_URL).catch(() => {});
  }

  stop(): void {
    this.quitting = true;
    if (this.recovering) clearTimeout(this.recovering);
    this.recovering = null;
    this.clearUnresponsive();
    this.destroyWindow();
  }

  private onUrl(): void {
    if (!this.win) return;
    const url = this.page.url();
    if (url !== this.curUrl) {
      this.prevUrl = this.curUrl;
      this.curUrl = url;
    }
    const { kind, reason } = classifyEngineUrl(url);
    if (kind === 'ready') {
      this.failures = 0;
      this.redirects.reset();
      this.handedOver = false;
      this.gaveUp = false;
      if (this.win.isVisible()) this.win.hide();
      this.setState('ready');
    } else if (kind === 'needsUser') {
      // The user is working through an auth step, so an earlier give-up no longer applies.
      this.handedOver = true;
      this.gaveUp = false;
      this.redirects.reset();
      this.needsUserReason = reason ?? 'login';
      this.setState('needsUser');
      this.showForUser();
    } else if (this.handedOver) {
      // The user is mid-flow (password reset, "log in with Facebook"): leave navigation alone.
      // The one exception is the page Instagram lands on right after a successful login.
      if (kind === 'goInbox' && this.isPostLoginLanding(url)) {
        void this.isLoggedIn()
          .then((ok) => {
            if (!ok || !this.handedOver) return;
            // The user finished an auth step: start a fresh redirect budget instead of inheriting the exhausted one. A plain '/' landing keeps its budget so it can't loop.
            if (this.cameFromAuth()) {
              this.gaveUp = false;
              this.redirects.reset();
            }
            this.redirectToInbox();
          })
          .catch(() => {});
      }
    } else if (kind === 'goInbox' || kind === 'foreign') {
      this.redirectToInbox();
    }
  }

  /**
   * The page Instagram lands on after the user finishes an auth step: any ordinary page reached straight from a
   * needsUser page (login, checkpoint, consent) or from Facebook/Meta ("Log in with Facebook"), or the site root
   * (any query) unless redirect recovery already gave up. Account pages are never a landing.
   */
  private isPostLoginLanding(url: string): boolean {
    try {
      const path = new URL(url).pathname;
      if (path.startsWith('/accounts/')) return false;
      if (this.cameFromAuth()) return true;
      return path === '/' && !this.gaveUp;
    } catch {
      return false;
    }
  }

  private cameFromAuth(): boolean {
    if (!this.prevUrl) return false;
    if (classifyEngineUrl(this.prevUrl).kind === 'needsUser') return true;
    try {
      const host = new URL(this.prevUrl).hostname;
      return ['facebook.com', 'meta.com'].some((d) => host === d || host.endsWith('.' + d));
    } catch {
      return false;
    }
  }

  /** Reloads the inbox with backoff; after repeated bounces hands the window to the user instead of looping. */
  private redirectToInbox(): void {
    const win = this.win;
    if (!win || this.redirecting) return;
    const decision = this.redirects.record();
    if (decision.action === 'giveUp') {
      this.handedOver = true;
      this.gaveUp = true;
      this.needsUserReason = 'challenge';
      this.setState('needsUser');
      this.showForUser();
      return;
    }
    this.redirecting = true;
    void (async () => {
      try {
        await this.sleep(decision.delayMs);
        if (this.win === win && this.state !== 'ready') await win.webContents.loadURL(ENGINE_START_URL).catch(() => {});
      } finally {
        this.redirecting = false;
      }
      // Events that arrived during the reload were ignored; look at where we ended up.
      if (this.win === win) this.onUrl();
    })();
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

  private clearUnresponsive(): void {
    if (this.unresponsive) clearTimeout(this.unresponsive);
    this.unresponsive = null;
  }

  private destroyWindow(): void {
    const win = this.win;
    this.win = null;
    this.cdpSession = null;
    this.redirecting = false;
    this.clearUnresponsive();
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
