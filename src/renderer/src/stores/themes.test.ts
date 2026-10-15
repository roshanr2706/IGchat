import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import { THEME_TOKENS } from '../../../shared/theme';
import { setBridge } from '../lib/api';
import { createFakeBridge } from '../lib/fakeBridge';
import { settings } from './settings.svelte';
import { themes } from './themes.svelte';

const tokens = Object.fromEntries(THEME_TOKENS.map((t) => [t, '#101010'])) as Record<(typeof THEME_TOKENS)[number], string>;
let saved: Settings;

beforeEach(() => {
  saved = sanitizeSettings(DEFAULT_SETTINGS);
  setBridge(
    createFakeBridge({
      'settings:set': (patch) => (saved = sanitizeSettings({ ...saved, ...patch })),
      'themes:listCustom': () => ({ themes: [{ id: 'custom-ocean', name: 'Ocean', appearance: 'dark', tokens }], errors: ['bad.json: not valid JSON'] })
    })
  );
  settings.init(DEFAULT_SETTINGS);
  themes.custom = [];
  themes.prefersDark = true;
});

describe('themes store', () => {
  it('resolves the active theme, including system', () => {
    expect(themes.active.id).toBe('dark');
    settings.init({ ...DEFAULT_SETTINGS, themeId: 'system' });
    themes.prefersDark = false;
    expect(themes.active.id).toBe('light');
  });

  it('falls back to dark for unknown ids', () => {
    settings.init({ ...DEFAULT_SETTINGS, themeId: 'custom-missing' });
    expect(themes.active.id).toBe('dark');
  });

  it('loads custom themes and their errors', async () => {
    await themes.loadCustom();
    expect(themes.all.map((t) => t.id)).toContain('custom-ocean');
    expect(themes.customErrors).toEqual(['bad.json: not valid JSON']);
  });

  it('cycles through all themes', () => {
    themes.cycle();
    expect(settings.value.themeId).toBe('catppuccin-latte');
    settings.init({ ...DEFAULT_SETTINGS, themeId: 'gruvbox-dark' });
    themes.cycle();
    expect(settings.value.themeId).toBe('light');
  });

  it('selects a theme', () => {
    themes.select('nord');
    expect(settings.value.themeId).toBe('nord');
  });
});
