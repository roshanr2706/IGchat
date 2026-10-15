import type { Settings } from '../shared/settings';
import type { ThemeDef } from '../shared/theme';
import { loadCustomThemes } from './customThemes';

/** Builds the synchronous startup reply. Never throws: a broken themes folder yields an empty theme list. */
export function startupPayload(settings: Settings, themesDir: string): { settings: Settings; customThemes: ThemeDef[] } {
  let customThemes: ThemeDef[] = [];
  try {
    customThemes = loadCustomThemes(themesDir).themes;
  } catch {
    customThemes = [];
  }
  return { settings, customThemes };
}
