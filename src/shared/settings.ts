export type DetailsPref = 'auto' | 'shown' | 'hidden';
export type SoundId = 'chime' | 'pop' | 'ding' | 'bubble' | 'custom' | 'none';
export const SOUND_IDS: readonly SoundId[] = ['chime', 'pop', 'ding', 'bubble', 'custom', 'none'];
export type WindowColors = { base: string; titlebar: string; symbol: string };

export type Settings = {
  themeId: string;
  /** #rrggbb override for the theme accent, or null to use the theme's own. */
  accent: string | null;
  fontScale: number;
  compact: boolean;
  sidebarWidth: number;
  detailsWidth: number;
  sidebarCollapsed: boolean;
  detailsPref: DetailsPref;
  /** Colors main uses for the window background and title-bar overlay before the renderer paints. */
  windowColors: WindowColors;
  /** The one-click reactions on a message's hover bar and menu (1–8 emoji). */
  quickReactions: string[];
  /** Closing the window hides it to the system tray instead of quitting. */
  closeToTray: boolean;
  /** Played for incoming messages; 'custom' plays the user's own file. */
  notificationSound: SoundId;
  /** 0–1. */
  soundVolume: number;
  /** File name of the user's custom sound, for display; null when none is set. */
  customSoundName: string | null;
  /** Check GitHub Releases for new versions and download them in the background. */
  autoUpdate: boolean;
};

export const MAX_QUICK_REACTIONS = 8;
const QUICK_DEFAULT = ['❤️', '😂', '😮', '😢', '👍'];

/** One emoji (possibly with modifiers / joiners), not text. */
function isEmoji(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) && !/[\p{L}\p{N}\s]/u.test(v.replace(/[#*0-9]/g, ''));
}

function quickReactions(v: unknown): string[] {
  if (!Array.isArray(v)) return [...QUICK_DEFAULT];
  const out = [...new Set(v.filter(isEmoji))].slice(0, MAX_QUICK_REACTIONS);
  return out.length ? out : [...QUICK_DEFAULT];
}

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 260;
export const DETAILS_MIN = 240;
export const DETAILS_MAX = 400;
export const DETAILS_DEFAULT = 300;
export const RAIL_WIDTH = 72;
export const FONT_SCALES = [0.875, 1, 1.125, 1.25] as const;
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_SETTINGS: Settings = {
  themeId: 'dark',
  accent: null,
  fontScale: 1,
  compact: false,
  sidebarWidth: SIDEBAR_DEFAULT,
  detailsWidth: DETAILS_DEFAULT,
  sidebarCollapsed: false,
  detailsPref: 'auto',
  windowColors: { base: '#313338', titlebar: '#1e1f22', symbol: '#dbdee1' },
  quickReactions: QUICK_DEFAULT,
  closeToTray: true,
  notificationSound: 'chime',
  soundVolume: 0.6,
  customSoundName: null,
  autoUpdate: true
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX_COLOR.test(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

export function sanitizeSettings(input: unknown): Settings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const wc = (o.windowColors && typeof o.windowColors === 'object' ? o.windowColors : {}) as Record<string, unknown>;
  return {
    themeId: typeof o.themeId === 'string' && o.themeId.length > 0 ? o.themeId : d.themeId,
    accent: isHex(o.accent) ? o.accent : null,
    fontScale: (FONT_SCALES as readonly number[]).includes(o.fontScale as number) ? (o.fontScale as number) : d.fontScale,
    compact: bool(o.compact, d.compact),
    sidebarWidth: clamp(num(o.sidebarWidth, d.sidebarWidth), SIDEBAR_MIN, SIDEBAR_MAX),
    detailsWidth: clamp(num(o.detailsWidth, d.detailsWidth), DETAILS_MIN, DETAILS_MAX),
    sidebarCollapsed: bool(o.sidebarCollapsed, d.sidebarCollapsed),
    detailsPref: o.detailsPref === 'auto' || o.detailsPref === 'shown' || o.detailsPref === 'hidden' ? o.detailsPref : d.detailsPref,
    windowColors: {
      base: isHex(wc.base) ? wc.base : d.windowColors.base,
      titlebar: isHex(wc.titlebar) ? wc.titlebar : d.windowColors.titlebar,
      symbol: isHex(wc.symbol) ? wc.symbol : d.windowColors.symbol
    },
    quickReactions: quickReactions(o.quickReactions),
    closeToTray: bool(o.closeToTray, d.closeToTray),
    notificationSound: SOUND_IDS.includes(o.notificationSound as SoundId) ? (o.notificationSound as SoundId) : d.notificationSound,
    soundVolume: clamp(num(o.soundVolume, d.soundVolume), 0, 1),
    customSoundName: typeof o.customSoundName === 'string' && o.customSoundName.length > 0 ? o.customSoundName.slice(0, 200) : null,
    autoUpdate: bool(o.autoUpdate, d.autoUpdate)
  };
}
