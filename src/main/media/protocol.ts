import { protocol, type Session } from 'electron';
import { MediaCache, serveMedia } from './cache';
import { MEDIA_SCHEME } from './url';

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

/** The UI loads igmedia:// URLs; the bytes are fetched with the engine's session, as the Instagram page's own image loads are. */
export function handleMediaRequests(uiSession: Session, fetchSession: Session, cache: MediaCache): void {
  // redirect: 'error' so a CDN redirect can never carry the fetch to a host outside the allow-list.
  uiSession.protocol.handle(MEDIA_SCHEME, (request) => serveMedia(request.url, cache, (url) => fetchSession.fetch(url, { redirect: 'error' })));
}
