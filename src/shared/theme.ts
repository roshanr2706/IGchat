import { HEX_COLOR, type WindowColors } from './settings';

export const THEME_TOKENS = [
  'bg-base',
  'bg-sidebar',
  'bg-titlebar',
  'bg-elevated',
  'bg-hover',
  'bg-active',
  'bg-input',
  'text-normal',
  'text-muted',
  'text-header',
  'text-link',
  'accent',
  'accent-text',
  'border',
  'danger',
  'mention-bg',
  'scrollbar'
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type Appearance = 'light' | 'dark';
export type ThemeDef = { id: string; name: string; appearance: Appearance; tokens: Record<ThemeToken, string> };
export type ThemeValidation = { ok: true; theme: ThemeDef } | { ok: false; error: string };

export function validateTheme(input: unknown): ThemeValidation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Theme must be a JSON object' };
  const o = input as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[a-z0-9-]+$/.test(o.id)) {
    return { ok: false, error: 'Theme "id" must use only lowercase letters, digits and dashes' };
  }
  if (typeof o.name !== 'string' || !o.name.trim()) return { ok: false, error: `Theme "${o.id}" needs a "name"` };
  if (o.appearance !== 'light' && o.appearance !== 'dark') {
    return { ok: false, error: `Theme "${o.id}": "appearance" must be "light" or "dark"` };
  }
  if (!o.tokens || typeof o.tokens !== 'object') return { ok: false, error: `Theme "${o.id}" is missing "tokens"` };
  const raw = o.tokens as Record<string, unknown>;
  const tokens = {} as Record<ThemeToken, string>;
  for (const key of THEME_TOKENS) {
    const value = raw[key];
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      return { ok: false, error: `Theme "${o.id}": token "${key}" must be a #rrggbb color` };
    }
    tokens[key] = value.toLowerCase();
  }
  return { ok: true, theme: { id: o.id, name: o.name.trim(), appearance: o.appearance, tokens } };
}

export function windowColorsFor(theme: ThemeDef): WindowColors {
  return { base: theme.tokens['bg-base'], titlebar: theme.tokens['bg-titlebar'], symbol: theme.tokens['text-normal'] };
}
