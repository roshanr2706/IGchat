export const MEDIA_SCHEME = 'igmedia';

export function isAllowedMediaHost(hostname: string): boolean {
  return /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(hostname);
}

/** Wraps an Instagram CDN https URL for the renderer. Anything else becomes '' (rendered as a placeholder). */
export function toMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !isAllowedMediaHost(u.hostname)) return '';
    return `${MEDIA_SCHEME}://m/${encodeURIComponent(url)}`;
  } catch {
    return '';
  }
}

/** Unwraps an igmedia:// URL back to the CDN URL, or null if it is malformed or not an allowed host. */
export function fromMediaUrl(mediaUrl: string): string | null {
  try {
    const u = new URL(mediaUrl);
    if (u.protocol !== `${MEDIA_SCHEME}:` || u.hostname !== 'm') return null;
    const inner = decodeURIComponent(u.pathname.slice(1));
    const target = new URL(inner);
    return target.protocol === 'https:' && isAllowedMediaHost(target.hostname) ? inner : null;
  } catch {
    return null;
  }
}
