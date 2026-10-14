import { THEME_TOKENS, type ThemeDef } from '../../../shared/theme';

export const SYSTEM_THEME_ID = 'system';

export function resolveThemeId(id: string, prefersDark: boolean): string {
  if (id !== SYSTEM_THEME_ID) return id;
  return prefersDark ? 'dark' : 'light';
}

/** Black or white, whichever reads better on the given #rrggbb background (WCAG relative luminance). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export function themeVars(theme: ThemeDef, accent: string | null): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of THEME_TOKENS) vars[`--${key}`] = theme.tokens[key];
  if (accent) {
    vars['--accent'] = accent;
    vars['--accent-text'] = readableOn(accent);
  }
  return vars;
}

export function applyTheme(root: HTMLElement, theme: ThemeDef, accent: string | null): void {
  for (const [name, value] of Object.entries(themeVars(theme, accent))) root.style.setProperty(name, value);
  root.dataset.appearance = theme.appearance;
  root.style.colorScheme = theme.appearance;
}
