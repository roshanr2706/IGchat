import type { Appearance, ThemeDef, ThemeToken } from '../../../shared/theme';

const def = (id: string, name: string, appearance: Appearance, tokens: Record<ThemeToken, string>): ThemeDef => ({ id, name, appearance, tokens });

type Catppuccin = {
  base: string; mantle: string; crust: string; surface0: string; surface1: string; surface2: string;
  text: string; subtext0: string; mauve: string; red: string; sapphire: string;
};

const catppuccin = (id: string, name: string, appearance: Appearance, c: Catppuccin): ThemeDef =>
  def(id, name, appearance, {
    'bg-base': c.base,
    'bg-sidebar': c.mantle,
    'bg-titlebar': c.crust,
    'bg-elevated': appearance === 'dark' ? c.crust : c.base,
    'bg-hover': c.surface0,
    'bg-active': c.surface1,
    'bg-input': appearance === 'dark' ? c.surface0 : c.mantle,
    'text-normal': c.text,
    'text-muted': c.subtext0,
    'text-header': c.text,
    'text-link': c.sapphire,
    accent: c.mauve,
    'accent-text': c.crust,
    border: appearance === 'dark' ? c.crust : c.surface0,
    danger: c.red,
    'mention-bg': c.surface1,
    scrollbar: c.surface2
  });

export const BUILTIN_THEMES: ThemeDef[] = [
  def('light', 'Light', 'light', {
    'bg-base': '#ffffff', 'bg-sidebar': '#f2f3f5', 'bg-titlebar': '#e3e5e8', 'bg-elevated': '#ffffff',
    'bg-hover': '#ebedef', 'bg-active': '#d7d9dc', 'bg-input': '#ebedef',
    'text-normal': '#313338', 'text-muted': '#5c5e66', 'text-header': '#060607', 'text-link': '#006ce7',
    accent: '#5865f2', 'accent-text': '#ffffff', border: '#e1e2e4', danger: '#da373c', 'mention-bg': '#e6e8fd', scrollbar: '#c4c9ce'
  }),
  def('dark', 'Dark', 'dark', {
    'bg-base': '#313338', 'bg-sidebar': '#2b2d31', 'bg-titlebar': '#1e1f22', 'bg-elevated': '#232428',
    'bg-hover': '#3a3c42', 'bg-active': '#404249', 'bg-input': '#383a40',
    'text-normal': '#dbdee1', 'text-muted': '#949ba4', 'text-header': '#f2f3f5', 'text-link': '#00a8fc',
    accent: '#5865f2', 'accent-text': '#ffffff', border: '#1f2023', danger: '#f23f43', 'mention-bg': '#393c5a', scrollbar: '#1a1b1e'
  }),
  catppuccin('catppuccin-latte', 'Catppuccin Latte', 'light', {
    base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8', surface0: '#ccd0da', surface1: '#bcc0cc', surface2: '#acb0be',
    text: '#4c4f69', subtext0: '#6c6f85', mauve: '#8839ef', red: '#d20f39', sapphire: '#209fb5'
  }),
  catppuccin('catppuccin-frappe', 'Catppuccin Frappé', 'dark', {
    base: '#303446', mantle: '#292c3c', crust: '#232634', surface0: '#414559', surface1: '#51576d', surface2: '#626880',
    text: '#c6d0f5', subtext0: '#a5adce', mauve: '#ca9ee6', red: '#e78284', sapphire: '#85c1dc'
  }),
  catppuccin('catppuccin-macchiato', 'Catppuccin Macchiato', 'dark', {
    base: '#24273a', mantle: '#1e2030', crust: '#181926', surface0: '#363a4f', surface1: '#494d64', surface2: '#5b6078',
    text: '#cad3f5', subtext0: '#a5adcb', mauve: '#c6a0f6', red: '#ed8796', sapphire: '#7dc4e4'
  }),
  catppuccin('catppuccin-mocha', 'Catppuccin Mocha', 'dark', {
    base: '#1e1e2e', mantle: '#181825', crust: '#11111b', surface0: '#313244', surface1: '#45475a', surface2: '#585b70',
    text: '#cdd6f4', subtext0: '#a6adc8', mauve: '#cba6f7', red: '#f38ba8', sapphire: '#74c7ec'
  }),
  def('nord', 'Nord', 'dark', {
    'bg-base': '#2e3440', 'bg-sidebar': '#2a2f3a', 'bg-titlebar': '#242933', 'bg-elevated': '#3b4252',
    'bg-hover': '#3b4252', 'bg-active': '#434c5e', 'bg-input': '#3b4252',
    'text-normal': '#d8dee9', 'text-muted': '#8a93a5', 'text-header': '#eceff4', 'text-link': '#88c0d0',
    accent: '#88c0d0', 'accent-text': '#2e3440', border: '#242933', danger: '#bf616a', 'mention-bg': '#434c5e', scrollbar: '#4c566a'
  }),
  def('dracula', 'Dracula', 'dark', {
    'bg-base': '#282a36', 'bg-sidebar': '#21222c', 'bg-titlebar': '#191a21', 'bg-elevated': '#21222c',
    'bg-hover': '#343746', 'bg-active': '#44475a', 'bg-input': '#343746',
    'text-normal': '#f8f8f2', 'text-muted': '#a4abc8', 'text-header': '#ffffff', 'text-link': '#8be9fd',
    accent: '#bd93f9', 'accent-text': '#282a36', border: '#191a21', danger: '#ff5555', 'mention-bg': '#44475a', scrollbar: '#44475a'
  }),
  def('gruvbox-dark', 'Gruvbox Dark', 'dark', {
    'bg-base': '#282828', 'bg-sidebar': '#1d2021', 'bg-titlebar': '#141617', 'bg-elevated': '#1d2021',
    'bg-hover': '#3c3836', 'bg-active': '#504945', 'bg-input': '#3c3836',
    'text-normal': '#ebdbb2', 'text-muted': '#a89984', 'text-header': '#fbf1c7', 'text-link': '#83a598',
    accent: '#fe8019', 'accent-text': '#1d2021', border: '#141617', danger: '#fb4934', 'mention-bg': '#45403d', scrollbar: '#504945'
  })
];

export const FALLBACK_THEME: ThemeDef = BUILTIN_THEMES.find((t) => t.id === 'dark')!;
