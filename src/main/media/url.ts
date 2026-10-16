export const MEDIA_SCHEME = 'igmedia';

function allowedUrl(u: URL): boolean {
  return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') && isAllowedMediaHost(u.hostname);
}

export function isAllowedMediaHost(hostname: string): boolean {
  return /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(hostname);
}

/** Wraps an Instagram CDN https URL for the renderer. Anything else becomes '' (rendered as a placeholder). */
export function toMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (!allowedUrl(u)) return '';
    return `${MEDIA_SCHEME}://m/${encodeURIComponent(u.href)}`;
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
    return allowedUrl(target) ? target.href : null;
  } catch {
    return null;
  }
}
