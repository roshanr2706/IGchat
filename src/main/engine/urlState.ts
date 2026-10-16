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
  if (u.protocol !== 'https:' || (u.hostname !== 'www.instagram.com' && u.hostname !== 'instagram.com')) return { kind: 'foreign' };
  const path = u.pathname;
  if (path.startsWith('/direct')) return { kind: 'ready' };
  if (/^\/(challenge|checkpoint|auth_platform)\b/.test(path)) return { kind: 'needsUser', reason: 'challenge' };
  if (/^\/(accounts\/(login|onetap|emailsignup|suspended)|consent|privacy\/checks)\b/.test(path)) return { kind: 'needsUser', reason: 'login' };
  return { kind: 'goInbox' };
}
