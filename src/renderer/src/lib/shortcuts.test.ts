import { describe, expect, it } from 'vitest';
import { matchShortcut } from './shortcuts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
});

describe('matchShortcut', () => {
  it('maps every documented shortcut', () => {
    expect(matchShortcut(key('k', { ctrlKey: true }))).toBe('switcher');
    expect(matchShortcut(key('K', { ctrlKey: true }))).toBe('switcher');
    expect(matchShortcut(key('b', { ctrlKey: true }))).toBe('toggleSidebar');
    expect(matchShortcut(key('i', { ctrlKey: true }))).toBe('toggleDetails');
    expect(matchShortcut(key(',', { ctrlKey: true }))).toBe('settings');
    expect(matchShortcut(key('T', { ctrlKey: true, shiftKey: true }))).toBe('cycleTheme');
    expect(matchShortcut(key('ArrowUp', { altKey: true }))).toBe('prevThread');
    expect(matchShortcut(key('ArrowDown', { altKey: true }))).toBe('nextThread');
    expect(matchShortcut(key('Escape'))).toBe('escape');
  });

  it('ignores plain keys and wrong modifiers', () => {
    expect(matchShortcut(key('k'))).toBeNull();
    expect(matchShortcut(key('t', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key('ArrowUp'))).toBeNull();
    expect(matchShortcut(key('k', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
