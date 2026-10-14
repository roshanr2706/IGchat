import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sanitizeSettings, type Settings } from '../shared/settings';

export class SettingsStore {
  private current: Settings;

  constructor(private readonly file: string) {
    this.current = SettingsStore.read(file);
  }

  private static read(file: string): Settings {
    try {
      return sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return sanitizeSettings({});
    }
  }

  get(): Settings {
    return sanitizeSettings(this.current);
  }

  update(patch: Partial<Settings>): Settings {
    this.current = sanitizeSettings({ ...this.current, ...patch });
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.current, null, 2));
    renameSync(tmp, this.file);
    return this.get();
  }
}
