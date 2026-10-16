import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../shared/types';
import { AccountCache } from './cache';

const thread = (id: string): Thread => ({ id, title: id, isGroup: false, participants: [], adminIds: [], lastActivityAt: 1, lastMessagePreview: 'p', unread: false, muted: false, avatarUrls: [] });

afterEach(() => vi.useRealTimers());

describe('AccountCache', () => {
  it('returns nothing before anything is saved, and recovers from corrupt files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-cache-'));
    expect(new AccountCache(dir).loadThreads()).toEqual([]);
    writeFileSync(join(dir, 'threads.json'), '{oops');
    expect(new AccountCache(dir).loadThreads()).toEqual([]);
    writeFileSync(join(dir, 'threads.json'), '[{"no":"id"},{"id":"ok","title":"t"}]');
    expect(new AccountCache(dir).loadThreads().map((t) => t.id)).toEqual(['ok']);
  });

  it('debounces writes and persists threads', () => {
    vi.useFakeTimers();
    const dir = join(mkdtempSync(join(tmpdir(), 'igchat-cache-')), 'nested');
    const cache = new AccountCache(dir, 1000);
    cache.saveThreads([thread('a')]);
    cache.saveThreads([thread('a'), thread('b')]);
    expect(existsSync(join(dir, 'threads.json'))).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(new AccountCache(dir).loadThreads().map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('clears the saved inbox', () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-cache-'));
    const cache = new AccountCache(dir, 0);
    cache.saveThreads([thread('a')]);
    cache.flush();
    cache.clear();
    expect(new AccountCache(dir).loadThreads()).toEqual([]);
  });

  it('drops entries with the wrong shape, and a failed write does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-cache-'));
    writeFileSync(join(dir, 'threads.json'), 'null');
    expect(new AccountCache(dir).loadThreads()).toEqual([]);
    writeFileSync(join(dir, 'threads.json'), '[null,1,"x",{"id":1,"title":"t"},{"id":"a","title":"t","participants":"nope"}]');
    expect(new AccountCache(dir).loadThreads()).toEqual([]);
    // the cache dir is an existing file, so mkdir fails: flush must swallow it
    const bad = new AccountCache(join(dir, 'threads.json'), 0);
    bad.saveThreads([thread('a')]);
    expect(() => bad.flush()).not.toThrow();
  });
});
