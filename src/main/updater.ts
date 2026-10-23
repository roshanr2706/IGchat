import type { UpdateStatus } from '../shared/ipc';

/** The slice of electron-updater's autoUpdater this module uses (injectable for tests). */
export type AutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update' | 'update-not-available', fn: () => void): unknown;
  on(event: 'update-available' | 'update-downloaded', fn: (info: { version: string }) => void): unknown;
  on(event: 'error', fn: (err: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
};

export type UpdaterDeps = {
  updater: AutoUpdaterLike | null;
  current: string;
  /** The auto-update setting; manual checks ignore it. */
  enabled: () => boolean;
  onStatus: (status: UpdateStatus) => void;
  /** Runs right before quitAndInstall, so close-to-tray lets the window go. */
  beforeInstall: () => void;
  firstCheckMs?: number;
  intervalMs?: number;
};

const FIRST_CHECK_MS = 10_000;
const INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Background updates from GitHub Releases. Checks shortly after launch and every few hours (the app can live in the
 * tray for days), downloads quietly, and reports 'ready' so the renderer can offer a restart. A downloaded update
 * also installs on the next normal quit.
 */
export class Updater {
  private status: UpdateStatus;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly deps: UpdaterDeps) {
    this.status = { state: deps.updater ? 'idle' : 'unsupported', current: deps.current };
    const u = deps.updater;
    if (!u) return;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => this.set({ state: 'checking' }));
    u.on('update-not-available', () => this.set({ state: 'none' }));
    u.on('update-available', (info) => this.set({ state: 'downloading', version: info.version }));
    u.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    u.on('error', (err) => this.set({ state: 'error', error: err.message.split('\n')[0]!.slice(0, 200) }));
  }

  get(): UpdateStatus {
    return { ...this.status };
  }

  start(): void {
    if (!this.deps.updater) return;
    const auto = (): void => {
      if (this.deps.enabled()) void this.check();
    };
    this.timers.push(setTimeout(auto, this.deps.firstCheckMs ?? FIRST_CHECK_MS));
    this.timers.push(setInterval(auto, this.deps.intervalMs ?? INTERVAL_MS));
    for (const t of this.timers) (t as { unref?: () => void }).unref?.();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Checks now; resolves with the status once the check (not the download) is done. */
  async check(): Promise<UpdateStatus> {
    const u = this.deps.updater;
    // A downloaded update stays ready; checking again would only download it twice.
    if (!u || this.status.state === 'ready' || this.status.state === 'downloading') return this.get();
    try {
      await u.checkForUpdates();
    } catch (err) {
      this.set({ state: 'error', error: err instanceof Error ? err.message.split('\n')[0]!.slice(0, 200) : String(err) });
    }
    return this.get();
  }

  install(): void {
    if (!this.deps.updater || this.status.state !== 'ready') return;
    this.deps.beforeInstall();
    this.deps.updater.quitAndInstall();
  }

  private set(next: Omit<UpdateStatus, 'current'>): void {
    // Keep the version found while downloading if the next event doesn't name one.
    const version = next.version ?? (next.state === 'ready' || next.state === 'downloading' ? this.status.version : undefined);
    this.status = { ...next, current: this.deps.current, ...(version ? { version } : {}) };
    this.deps.onStatus(this.get());
  }
}
