import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import { call } from '../lib/api';

class SettingsStore {
  value = $state<Settings>(sanitizeSettings(DEFAULT_SETTINGS));

  init(initial: Settings): void {
    this.value = sanitizeSettings(initial);
  }

  private seq = 0;

  /** Applies the patch immediately, then persists it in main (which returns the canonical value). */
  async update(patch: Partial<Settings>): Promise<void> {
    const mine = ++this.seq;
    this.value = sanitizeSettings({ ...this.value, ...patch });
    try {
      const canonical = await call('settings:set', patch);
      // Main applies patches serially, so only the latest response is complete; apply it only then.
      if (mine === this.seq) this.value = canonical;
    } catch {
      // Keep the optimistic value for this session; main did not persist this patch.
    }
  }
}

export const settings = new SettingsStore();
