import { describe, expect, it } from 'vitest';
import { validateTheme } from '../../../shared/theme';
import { BUILTIN_THEMES, FALLBACK_THEME } from './builtin';

describe('built-in themes', () => {
  it('ships the required themes', () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual([
      'light',
      'dark',
      'catppuccin-latte',
      'catppuccin-frappe',
      'catppuccin-macchiato',
      'catppuccin-mocha',
      'nord',
      'dracula',
      'gruvbox-dark'
    ]);
  });

  it('are all valid', () => {
    for (const theme of BUILTIN_THEMES) {
      const r = validateTheme(theme);
      expect(r, theme.id).toEqual({ ok: true, theme });
    }
  });

  it('falls back to dark', () => {
    expect(FALLBACK_THEME.id).toBe('dark');
  });
});
