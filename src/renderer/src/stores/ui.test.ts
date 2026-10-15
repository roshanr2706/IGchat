import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import { makeText } from '../../../shared/test/factories';
import { setBridge } from '../lib/api';
import { createFakeBridge } from '../lib/fakeBridge';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';

let saved: Settings;

beforeEach(() => {
  saved = sanitizeSettings(DEFAULT_SETTINGS);
  setBridge(createFakeBridge({ 'settings:set': (patch) => (saved = sanitizeSettings({ ...saved, ...patch })) }));
  settings.init(DEFAULT_SETTINGS);
  ui.windowWidth = 1000;
  ui.replyTo = null;
  ui.editingId = null;
  ui.lightbox = null;
  ui.confirmUnsend = null;
  ui.contextMenu = null;
  ui.switcherOpen = false;
  ui.settingsOpen = false;
});

describe('ui store', () => {
  it('uses the rail below 700px or when collapsed', () => {
    expect(ui.sidebarMode).toBe('full');
    ui.windowWidth = 650;
    expect(ui.sidebarMode).toBe('rail');
    ui.windowWidth = 1000;
    settings.init({ ...DEFAULT_SETTINGS, sidebarCollapsed: true });
    expect(ui.sidebarMode).toBe('rail');
  });

  it('auto-shows details at 1280px and respects explicit preferences', () => {
    expect(ui.detailsVisible).toBe(false);
    ui.windowWidth = 1280;
    expect(ui.detailsVisible).toBe(true);
    settings.init({ ...DEFAULT_SETTINGS, detailsPref: 'hidden' });
    expect(ui.detailsVisible).toBe(false);
    ui.windowWidth = 900;
    settings.init({ ...DEFAULT_SETTINGS, detailsPref: 'shown' });
    expect(ui.detailsVisible).toBe(true);
  });

  it('toggles details into an explicit preference and persists it', async () => {
    ui.windowWidth = 1400;
    ui.toggleDetails();
    expect(settings.value.detailsPref).toBe('hidden');
    await vi.waitFor(() => expect(saved.detailsPref).toBe('hidden'));
    ui.toggleDetails();
    expect(settings.value.detailsPref).toBe('shown');
  });

  it('toggles sidebar collapse', () => {
    ui.toggleSidebar();
    expect(settings.value.sidebarCollapsed).toBe(true);
  });

  it('closes overlays in priority order', () => {
    ui.replyTo = makeText();
    ui.editingId = 'm1';
    ui.switcherOpen = true;
    ui.contextMenu = { threadId: 't', messageId: 'm', x: 0, y: 0 };
    expect(ui.closeTopModal()).toBe(true);
    expect(ui.contextMenu).toBeNull();
    expect(ui.switcherOpen).toBe(true);
    ui.closeTopModal();
    expect(ui.switcherOpen).toBe(false);
    ui.closeTopModal();
    expect(ui.editingId).toBeNull();
    ui.closeTopModal();
    expect(ui.replyTo).toBeNull();
    expect(ui.closeTopModal()).toBe(false);
  });

  it('shows toasts that expire', () => {
    vi.useFakeTimers();
    ui.toast('hello');
    expect(ui.toasts.map((t) => t.text)).toContain('hello');
    vi.advanceTimersByTime(5000);
    expect(ui.toasts.map((t) => t.text)).not.toContain('hello');
    vi.useRealTimers();
  });
});
