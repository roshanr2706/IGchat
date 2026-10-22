import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Thread } from '../../shared/types';
import type { CacheLike } from './service';

const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The last known inbox (normalized threads only), so the app paints instantly before the engine is ready. */
export class AccountCache implements CacheLike {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Thread[] | null = null;

  constructor(
    private readonly dir: string,
    private readonly debounceMs = 1000
  ) {}

  private get file(): string {
    return join(this.dir, 'threads.json');
  }

  loadThreads(): Thread[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      const out: Thread[] = [];
      for (const t of parsed as unknown[]) {
        if (!t || typeof t !== 'object') continue;
        const r = t as Partial<Thread>;
        if (typeof r.id !== 'string' || typeof r.title !== 'string') continue;
        // Optional list fields must be arrays if present; missing ones are defaulted so the UI never sees undefined.
        if (r.participants !== undefined && !Array.isArray(r.participants)) continue;
        if (r.adminIds !== undefined && !isStringArray(r.adminIds)) continue;
        if (r.avatarUrls !== undefined && !isStringArray(r.avatarUrls)) continue;
        out.push({ ...(r as Thread), participants: r.participants ?? [], adminIds: r.adminIds ?? [], avatarUrls: r.avatarUrls ?? [] });
      }
      return out;
    } catch {
      return [];
    }
  }

  saveThreads(threads: Thread[]): void {
    this.pending = threads;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Writes the pending inbox. Disk errors are swallowed: the cache is an optimisation, never a crash. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    const tmp = `${this.file}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(pending));
      renameSync(tmp, this.file);
    } catch {
      // force only ignores ENOENT; on Linux a blocked path gives ENOTDIR, which must not escape either
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* nothing to clean up */
      }
    }
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    try {
      rmSync(this.file, { force: true });
    } catch {
      /* nothing to clear */
    }
  }
}
