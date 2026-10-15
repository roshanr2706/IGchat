import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startupPayload } from './startupPayload';

describe('startupPayload', () => {
  it('falls back to no custom themes when the themes path is a regular file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'igchat-')), 'themes');
    writeFileSync(file, 'not a folder');
    const settings = { windowColors: { base: '#000000' } } as never;
    expect(startupPayload(settings, file)).toEqual({ settings, customThemes: [] });
  });
});
