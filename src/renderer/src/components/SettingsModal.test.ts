import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import { setBridge } from '../lib/api';
import { createFakeBridge, type FakeBridge } from '../lib/fakeBridge';
import { settings } from '../stores/settings.svelte';
import { themes } from '../stores/themes.svelte';
import { ui } from '../stores/ui.svelte';
import SettingsModal from './SettingsModal.svelte';

let bridge: FakeBridge;
let saved: Settings;

beforeEach(() => {
  saved = sanitizeSettings(DEFAULT_SETTINGS);
  bridge = createFakeBridge({
    'settings:set': (patch) => (saved = sanitizeSettings({ ...saved, ...patch })),
    'themes:openFolder': () => undefined,
    'themes:listCustom': () => ({ themes: [], errors: [] })
  });
  setBridge(bridge);
  settings.init(DEFAULT_SETTINGS);
  themes.custom = [];
  themes.customErrors = [];
  themes.prefersDark = true;
  ui.settingsOpen = true;
});

describe('SettingsModal', () => {
  it('offers System and every built-in theme', () => {
    render(SettingsModal);
    for (const name of ['System', 'Light', 'Dark', 'Catppuccin Latte', 'Catppuccin Frappé', 'Catppuccin Macchiato', 'Catppuccin Mocha', 'Nord', 'Dracula', 'Gruvbox Dark']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('switches theme and persists it', async () => {
    const user = userEvent.setup();
    render(SettingsModal);
    await user.click(screen.getByRole('button', { name: 'Catppuccin Mocha' }));
    expect(settings.value.themeId).toBe('catppuccin-mocha');
    await vi.waitFor(() => expect(saved.themeId).toBe('catppuccin-mocha'));
  });

  it('toggles compact mode and the custom accent', async () => {
    const user = userEvent.setup();
    render(SettingsModal);
    await user.click(screen.getByRole('checkbox', { name: 'Compact mode' }));
    expect(settings.value.compact).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Use a custom accent color' }));
    expect(settings.value.accent).toBe('#5865f2');
    expect(screen.getByLabelText('Accent color')).toBeTruthy();
  });

  it('changes the font size', async () => {
    const user = userEvent.setup();
    render(SettingsModal);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Font size' }), 'Extra large');
    expect(settings.value.fontScale).toBe(1.25);
  });

  it('resets the panel layout', async () => {
    const user = userEvent.setup();
    settings.init({ ...DEFAULT_SETTINGS, sidebarWidth: 400, detailsWidth: 380, sidebarCollapsed: true, detailsPref: 'hidden' });
    render(SettingsModal);
    await user.click(screen.getByRole('button', { name: 'Reset panel layout' }));
    expect(settings.value).toMatchObject({ sidebarWidth: 260, detailsWidth: 300, sidebarCollapsed: false, detailsPref: 'auto' });
  });

  it('shows custom theme errors and opens the themes folder', async () => {
    const user = userEvent.setup();
    themes.customErrors = ['bad.json: not valid JSON'];
    render(SettingsModal);
    expect(screen.getByText('bad.json: not valid JSON')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open themes folder' }));
    expect(bridge.calls.some((c) => c.channel === 'themes:openFolder')).toBe(true);
  });

  it('closes with the ✕ button', async () => {
    const user = userEvent.setup();
    render(SettingsModal);
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(ui.settingsOpen).toBe(false);
  });
});

describe('SettingsModal quick reactions', () => {
  it('replaces, adds and removes quick reactions, and resets them', async () => {
    const user = userEvent.setup();
    render(SettingsModal);
    // Replace the first one (❤️) with 🥀 through the picker.
    await user.click(screen.getByRole('button', { name: 'Change quick reaction ❤️' }));
    const picker = await screen.findByRole('dialog', { name: 'Pick a reaction' });
    await user.type(within(picker).getByRole('textbox', { name: 'Search emoji' }), 'wilted');
    await user.click(await within(picker).findByRole('button', { name: 'React with 🥀' }));
    expect(settings.value.quickReactions[0]).toBe('🥀');
    // Add one, then remove one.
    await user.click(screen.getByRole('button', { name: 'Add a quick reaction' }));
    const add = await screen.findByRole('dialog', { name: 'Pick a reaction' });
    await user.type(within(add).getByRole('textbox', { name: 'Search emoji' }), 'grin');
    await user.click((await within(add).findAllByRole('button', { name: /^React with / }))[0]!);
    expect(settings.value.quickReactions).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Remove quick reaction 😂' }));
    expect(settings.value.quickReactions).not.toContain('😂');
    await user.click(screen.getByRole('button', { name: 'Reset quick reactions' }));
    expect(settings.value.quickReactions).toEqual(DEFAULT_SETTINGS.quickReactions);
    await vi.waitFor(() => expect(saved.quickReactions).toEqual(DEFAULT_SETTINGS.quickReactions));
  });
});
