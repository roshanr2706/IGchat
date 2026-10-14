import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { SettingsStore } from './settingsStore';

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'igchat-')), 'nested', 'settings.json');

describe('SettingsStore', () => {
  it('starts with defaults when no file exists', () => {
    expect(new SettingsStore(tmpFile()).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists updates and reloads them', () => {
    const file = tmpFile();
    const store = new SettingsStore(file);
    const next = store.update({ themeId: 'nord', sidebarWidth: 300 });
    expect(next.themeId).toBe('nord');
    expect(JSON.parse(readFileSync(file, 'utf8')).sidebarWidth).toBe(300);
    expect(new SettingsStore(file).get().themeId).toBe('nord');
  });

  it('sanitizes patches', () => {
    const store = new SettingsStore(tmpFile());
    expect(store.update({ sidebarWidth: 5 }).sidebarWidth).toBe(180);
  });

  it('recovers from a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-'));
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{oops');
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns copies that cannot mutate internal state', () => {
    const store = new SettingsStore(tmpFile());
    store.get().windowColors.base = '#000000';
    expect(store.get().windowColors.base).toBe(DEFAULT_SETTINGS.windowColors.base);
  });
});
