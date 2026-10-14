import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS } from '../shared/theme';
import { loadCustomThemes } from './customThemes';

const tokens = Object.fromEntries(THEME_TOKENS.map((t) => [t, '#123456']));

describe('loadCustomThemes', () => {
  it('creates the folder when missing and returns nothing', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'igchat-')), 'themes');
    expect(loadCustomThemes(dir)).toEqual({ themes: [], errors: [] });
    expect(existsSync(dir)).toBe(true);
  });

  it('loads valid themes with a custom- prefix and reports invalid files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ id: 'ocean', name: 'Ocean', appearance: 'dark', tokens }));
    writeFileSync(join(dir, 'b.json'), '{ not json');
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ id: 'half', name: 'Half', appearance: 'dark', tokens: {} }));
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    const result = loadCustomThemes(dir);
    expect(result.themes.map((t) => t.id)).toEqual(['custom-ocean']);
    expect(result.errors).toEqual(['b.json: not valid JSON', 'c.json: Theme "half": token "bg-base" must be a #rrggbb color']);
  });
});
