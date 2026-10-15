import type { ThemeDef } from '../../../shared/theme';
import { call } from '../lib/api';
import { resolveThemeId } from '../themes/apply';
import { BUILTIN_THEMES, FALLBACK_THEME } from '../themes/builtin';
import { settings } from './settings.svelte';

class ThemeStore {
  custom = $state<ThemeDef[]>([]);
  customErrors = $state<string[]>([]);
  prefersDark = $state(true);
  all = $derived<ThemeDef[]>([...BUILTIN_THEMES, ...this.custom]);
  active = $derived<ThemeDef>(this.all.find((t) => t.id === resolveThemeId(settings.value.themeId, this.prefersDark)) ?? FALLBACK_THEME);

  async loadCustom(): Promise<void> {
    try {
      const result = await call('themes:listCustom');
      this.custom = result.themes;
      this.customErrors = result.errors;
    } catch {
      this.customErrors = ['Could not read the custom themes folder'];
    }
  }

  select(id: string): void {
    void settings.update({ themeId: id });
  }

  cycle(): void {
    const ids = this.all.map((t) => t.id);
    const index = ids.indexOf(this.active.id);
    this.select(ids[(index + 1) % ids.length]!);
  }
}

export const themes = new ThemeStore();
