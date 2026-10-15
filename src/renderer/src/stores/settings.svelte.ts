import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import { call } from '../lib/api';

class SettingsStore {
  value = $state<Settings>(sanitizeSettings(DEFAULT_SETTINGS));

  init(initial: Settings): void {
    this.value = sanitizeSettings(initial);
  }

  /** Applies the patch immediately, then persists it in main (which returns the canonical value). */
  async update(patch: Partial<Settings>): Promise<void> {
    this.value = sanitizeSettings({ ...this.value, ...patch });
    try {
      this.value = await call('settings:set', patch);
    } catch {
      // Keep the optimistic value; it will be persisted with the next successful update.
    }
  }
}

export const settings = new SettingsStore();
