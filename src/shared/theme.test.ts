import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, validateTheme, windowColorsFor } from './theme';

const tokens = Object.fromEntries(THEME_TOKENS.map((t) => [t, '#112233']));

describe('validateTheme', () => {
  it('accepts a complete theme and lowercases colors', () => {
    const r = validateTheme({ id: 'my-theme', name: ' Mine ', appearance: 'dark', tokens: { ...tokens, accent: '#AABBCC' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.theme.name).toBe('Mine');
      expect(r.theme.tokens.accent).toBe('#aabbcc');
    }
  });

  it('rejects bad ids, names, appearance and tokens', () => {
    expect(validateTheme({ id: 'Bad Id', name: 'x', appearance: 'dark', tokens }).ok).toBe(false);
    expect(validateTheme({ id: 'x', name: '', appearance: 'dark', tokens }).ok).toBe(false);
    expect(validateTheme({ id: 'x', name: 'x', appearance: 'dim', tokens }).ok).toBe(false);
    expect(validateTheme({ id: 'x', name: 'x', appearance: 'dark' }).ok).toBe(false);
    expect(validateTheme(42).ok).toBe(false);
  });

  it('names the missing token in the error', () => {
    const { accent: _omit, ...partial } = tokens;
    const r = validateTheme({ id: 'x', name: 'x', appearance: 'light', tokens: partial });
    expect(r).toEqual({ ok: false, error: 'Theme "x": token "accent" must be a #rrggbb color' });
  });

  it('derives window colors', () => {
    const r = validateTheme({ id: 'x', name: 'x', appearance: 'light', tokens: { ...tokens, 'bg-base': '#ffffff', 'bg-titlebar': '#eeeeee', 'text-normal': '#000000' } });
    if (!r.ok) throw new Error(r.error);
    expect(windowColorsFor(r.theme)).toEqual({ base: '#ffffff', titlebar: '#eeeeee', symbol: '#000000' });
  });
});
