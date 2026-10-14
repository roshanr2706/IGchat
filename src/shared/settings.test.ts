import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DETAILS_MAX, SIDEBAR_MIN, sanitizeSettings } from './settings';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, themeId: 'nord', compact: true, fontScale: 1.25, detailsPref: 'hidden' });
    expect(s.themeId).toBe('nord');
    expect(s.compact).toBe(true);
    expect(s.fontScale).toBe(1.25);
    expect(s.detailsPref).toBe('hidden');
  });

  it('clamps panel widths', () => {
    const s = sanitizeSettings({ sidebarWidth: 10, detailsWidth: 9999 });
    expect(s.sidebarWidth).toBe(SIDEBAR_MIN);
    expect(s.detailsWidth).toBe(DETAILS_MAX);
  });

  it('rejects invalid accent, font scale and detailsPref', () => {
    const s = sanitizeSettings({ accent: 'red', fontScale: 3, detailsPref: 'sometimes' });
    expect(s.accent).toBeNull();
    expect(s.fontScale).toBe(1);
    expect(s.detailsPref).toBe('auto');
  });

  it('accepts a hex accent', () => {
    expect(sanitizeSettings({ accent: '#ff00aa' }).accent).toBe('#ff00aa');
  });

  it('sanitizes window colors field by field', () => {
    const s = sanitizeSettings({ windowColors: { base: '#000000', titlebar: 'blue' } });
    expect(s.windowColors).toEqual({ base: '#000000', titlebar: DEFAULT_SETTINGS.windowColors.titlebar, symbol: DEFAULT_SETTINGS.windowColors.symbol });
  });

  it('returns fresh objects (no shared references with defaults)', () => {
    const s = sanitizeSettings({});
    expect(s).not.toBe(DEFAULT_SETTINGS);
    expect(s.windowColors).not.toBe(DEFAULT_SETTINGS.windowColors);
  });
});
