export type UrlKind = 'ready' | 'needsUser' | 'goInbox' | 'starting' | 'foreign';

/** Where the engine page is, and what IGchat should do about it. */
export function classifyEngineUrl(url: string): { kind: UrlKind; reason?: 'login' | 'challenge' } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'starting' };
  }
  if (u.protocol === 'about:') return { kind: 'starting' };
  if (u.protocol !== 'https:' || u.port !== '' || (u.hostname !== 'www.instagram.com' && u.hostname !== 'instagram.com')) return { kind: 'foreign' };
  const path = u.pathname;
  if (/^\/direct(\/|$)/.test(path)) return { kind: 'ready' };
  if (/^\/(challenge|checkpoint|auth_platform)\b/.test(path)) return { kind: 'needsUser', reason: 'challenge' };
  if (/^\/(accounts\/(login|onetap|emailsignup|suspended)|consent|privacy\/checks)\b/.test(path)) return { kind: 'needsUser', reason: 'login' };
  return { kind: 'goInbox' };
}

const ALLOWED_NAV_DOMAINS = ['instagram.com', 'facebook.com', 'meta.com'];

/** Hosts the engine window may navigate to itself (Instagram plus the Facebook/Meta hosts used by login and checkpoints). */
export function isAllowedNavigation(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.port !== '') return false;
  return ALLOWED_NAV_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith('.' + d));
}

export type RedirectDecision = { action: 'reload'; delayMs: number } | { action: 'giveUp' };

/** Bounds how often the engine reloads the inbox after landing somewhere else: backoff 1s, 2s, 4s, then hand over to the user. */
export class RedirectPolicy {
  private stamps: number[] = [];

  constructor(
    private readonly max = 3,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  record(): RedirectDecision {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
    this.stamps.push(t);
    if (this.stamps.length > this.max) return { action: 'giveUp' };
    return { action: 'reload', delayMs: 1000 * 2 ** (this.stamps.length - 1) };
  }

  reset(): void {
    this.stamps = [];
  }
}
