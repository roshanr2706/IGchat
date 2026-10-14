import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CustomThemes } from '../shared/ipc';
import { validateTheme, type ThemeDef } from '../shared/theme';

/** Reads every *.json file in `dir` as a theme. Ids are prefixed with `custom-` so they never clash with built-ins. */
export function loadCustomThemes(dir: string): CustomThemes {
  mkdirSync(dir, { recursive: true });
  const themes: ThemeDef[] = [];
  const errors: string[] = [];
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      errors.push(`${file}: not valid JSON`);
      continue;
    }
    const result = validateTheme(parsed);
    if (!result.ok) {
      errors.push(`${file}: ${result.error}`);
      continue;
    }
    themes.push({ ...result.theme, id: `custom-${result.theme.id}` });
  }
  return { themes, errors };
}
