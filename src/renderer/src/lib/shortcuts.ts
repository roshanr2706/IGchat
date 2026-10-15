export type ShortcutAction =
  | 'switcher'
  | 'prevThread'
  | 'nextThread'
  | 'toggleSidebar'
  | 'toggleDetails'
  | 'settings'
  | 'cycleTheme'
  | 'escape';

export type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && !e.altKey && !e.shiftKey) {
    if (k === 'k') return 'switcher';
    if (k === 'b') return 'toggleSidebar';
    if (k === 'i') return 'toggleDetails';
    if (k === ',') return 'settings';
  }
  if (mod && e.shiftKey && !e.altKey && k === 't') return 'cycleTheme';
  if (e.altKey && !mod && !e.shiftKey) {
    if (e.key === 'ArrowUp') return 'prevThread';
    if (e.key === 'ArrowDown') return 'nextThread';
  }
  if (e.key === 'Escape' && !mod && !e.altKey) return 'escape';
  return null;
}
