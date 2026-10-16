import { BrowserWindow, session, shell, type Debugger } from 'electron';
import type { EngineState } from '../../shared/types';
import { ServiceError } from '../chatService';
import { Emitter } from '../emitter';
import { CLICK_SEND_SCRIPT, clickThreadLinkScript, pathMatchesThread, setFileOnPageInput, threadPathFor, waitForThreadUrl } from './pageScripts';
import type { CdpLike, EngineLike, PageLike } from './types';
import { classifyEngineUrl, isAllowedNavigation, RedirectPolicy, threadIdFromUrl } from './urlState';

export const ENGINE_PARTITION = 'persist:ig';
export const ENGINE_START_URL = 'https://www.instagram.com/direct/inbox/';

const THREAD_NAV_TIMEOUT_MS = 8000;
const RESPONSIVE_GRACE_MS = 10_000;
const READY_SETTLE_MS = 3000;
const USER_THREAD_TIMEOUT_MS = 12_000;
/** Instagram handles: letters, digits, dots and underscores, at most 30. Anything else never reaches a URL. */
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

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
  /** True while openUserThread follows an ig.me link: the hops through ig.me are not bounces and must not reload the inbox. */
  private followingLink = false;
  /** Hard ceiling on automatic inbox reloads that no navigation can reset: only an explicit start() or logout() does. */
  private readonly bounceCap = new RedirectPolicy(6, 10 * 60_000);
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
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
    // An explicit start gets a fresh cap; recovery rebuilds go through launch() and keep it.
    this.bounceCap.reset();
    return this.launch();
  }

  private launch(): Promise<void> {
    if (this.starting) return this.starting;
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

  /**
   * Follows Instagram's own ig.me link for a username (as a browser click would) and returns the DM thread id it lands
   * on. Returns null for an invalid username, a page that is not ready, or when the thread isn't reached in time.
   */
  async openUserThread(username: string): Promise<string | null> {
    const win = this.win;
    if (!win || this.state !== 'ready' || !USERNAME_RE.test(username) || this.followingLink) return null;
    this.followingLink = true;
    const before = this.page.url();
    let ok = false;
    try {
      let loaded = true;
      // ig.me redirects to instagram.com (an allowed host), so the redirect guard lets it through. Bounded in case the load hangs.
      let cap: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        win.webContents.loadURL(`https://ig.me/m/${username}`).catch(() => {
          loaded = false;
        }),
        new Promise<void>((resolve) => {
          cap = setTimeout(() => {
            loaded = false;
            resolve();
          }, USER_THREAD_TIMEOUT_MS);
        })
      ]).finally(() => clearTimeout(cap));
      for (let waited = 0; waited <= USER_THREAD_TIMEOUT_MS; waited += 250) {
        if (this.win !== win) return null;
        const url = this.page.url();
        const id = threadIdFromUrl(url);
        // A failed load that left us on the thread we were already viewing is not an answer.
        if (id && (loaded || url !== before)) {
          ok = true;
          return id;
        }
        if (classifyEngineUrl(url).kind === 'needsUser') break;
        await this.sleep(250);
      }
      if (this.win !== win) return null;
      if (classifyEngineUrl(this.page.url()).kind === 'needsUser') {
        // A login wall or checkpoint on the hop: the normal handler hands the window to the user.
        this.followingLink = false;
        this.onUrl();
        throw new ServiceError('AuthExpired', 'Log in to Instagram');
      }
      return null;
    } finally {
      if (this.win === win) {
        if (ok) {
          this.followingLink = false;
          this.onUrl();
        } else if ((this.state as EngineState) !== 'needsUser') {
          await this.recoverFromFailedHop(win);
        }
      }
      this.followingLink = false;
    }
  }

  /** A hop that went nowhere: one explicit, bounded load of the inbox. It counts against the hard cap but never escalates to a hand-over loop. */
  private async recoverFromFailedHop(win: BrowserWindow): Promise<void> {
    if (this.bounceCap.record().action === 'giveUp') {
      this.handOver();
      return;
    }
    await win.webContents.loadURL(ENGINE_START_URL).catch(() => {});
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
    this.bounceCap.reset();
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
    this.cancelReadyTimer();
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
    if (kind !== 'ready') this.cancelReadyTimer();
    if (kind === 'ready') {
      this.failures = 0;
      this.handedOver = false;
      this.gaveUp = false;
      // A transient ready page must not wipe the per-episode redirect budget: reset it once ready has held for a moment.
      this.readyTimer ??= setTimeout(() => {
        this.readyTimer = null;
        if (this.state === 'ready') this.redirects.reset();
      }, READY_SETTLE_MS);
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
    } else if (this.followingLink) {
      // openUserThread is mid-hop (ig.me -> instagram.com -> the thread); it re-checks the page when it finishes.
    } else if (this.handedOver) {
      // The user is mid-flow (password reset, "log in with Facebook"): leave navigation alone, except for the landing page.
      if (kind === 'goInbox' && this.isPostLoginLanding(url)) {
        void this.isLoggedIn()
          .then((ok) => {
            if (!ok || !this.handedOver) return;
            // Finishing an auth step earns a fresh per-episode budget; the hard cap still applies.
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
   * While the user has the window (handedOver), the only page IGchat sends back to the inbox is the landing after a
   * finished auth step, and only when the sessionid cookie exists. A landing is an ordinary Instagram page outside
   * /accounts/ that is either the site root (any query), unless redirect recovery gave up, or was reached straight
   * from an auth page: a needsUser page (login, checkpoint, consent) or Facebook/Meta login, checkpoint and OAuth.
   * Anything else is left alone so flows like password reset work.
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
      const prev = new URL(this.prevUrl);
      const host = prev.hostname;
      const underDomain = (d: string): boolean => host === d || host.endsWith('.' + d);
      if (host === 'auth.meta.com' || host.startsWith('accountscenter.')) return true;
      if (underDomain('facebook.com') || underDomain('meta.com')) {
        return ['/login', '/checkpoint', '/dialog/oauth'].some((p) => prev.pathname.startsWith(p));
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Reloads the inbox with backoff; after repeated bounces hands the window to the user instead of looping. */
  private redirectToInbox(): void {
    const win = this.win;
    if (!win || this.redirecting) return;
    if (this.bounceCap.record().action === 'giveUp') {
      this.handOver();
      return;
    }
    const decision = this.redirects.record();
    if (decision.action === 'giveUp') {
      this.handOver();
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

  private handOver(): void {
    this.handedOver = true;
    this.gaveUp = true;
    this.needsUserReason = 'challenge';
    this.setState('needsUser');
    this.showForUser();
  }

  private cancelReadyTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
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
      void this.launch().catch(() => this.recover());
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
    this.cancelReadyTimer();
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
