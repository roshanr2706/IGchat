import type { UpdateStatus } from '../../../shared/ipc';
import { call, on } from '../lib/api';

class UpdateStore {
  status = $state<UpdateStatus | null>(null);
  /** The version whose restart banner the user dismissed with "Later". */
  dismissed = $state<string | null>(null);
  checking = $state(false);

  get bannerVersion(): string | null {
    const s = this.status;
    return s?.state === 'ready' && s.version && s.version !== this.dismissed ? s.version : null;
  }

  async load(): Promise<void> {
    this.status = await call('update:status').catch(() => null);
  }

  async check(): Promise<void> {
    this.checking = true;
    try {
      this.status = await call('update:check');
    } catch {
      // keep the last known status
    } finally {
      this.checking = false;
    }
  }

  install(): void {
    void call('update:install').catch(() => {});
  }

  subscribe(): () => void {
    return on('update:status', (status) => (this.status = status));
  }
}

export const update = new UpdateStore();
