import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from './builtin';
import { applyTheme, readableOn, resolveThemeId, themeVars } from './apply';

const dark = BUILTIN_THEMES.find((t) => t.id === 'dark')!;

describe('theme application', () => {
  it('resolves the system pseudo-theme', () => {
    expect(resolveThemeId('system', true)).toBe('dark');
    expect(resolveThemeId('system', false)).toBe('light');
    expect(resolveThemeId('nord', false)).toBe('nord');
  });

  it('picks readable text for an accent', () => {
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#f9e2af')).toBe('#000000');
    expect(readableOn('#5865f2')).toBe('#ffffff');
    expect(readableOn('#000000')).toBe('#ffffff');
  });

  it('maps tokens to CSS variables with optional accent override', () => {
    const vars = themeVars(dark, null);
    expect(vars['--bg-base']).toBe(dark.tokens['bg-base']);
    expect(vars['--accent']).toBe(dark.tokens.accent);
    const overridden = themeVars(dark, '#ffffff');
    expect(overridden['--accent']).toBe('#ffffff');
    expect(overridden['--accent-text']).toBe('#000000');
  });

  it('applies variables and appearance to an element', () => {
    const el = document.createElement('div');
    applyTheme(el, dark, null);
    expect(el.style.getPropertyValue('--bg-base')).toBe(dark.tokens['bg-base']);
    expect(el.dataset.appearance).toBe('dark');
  });
});
