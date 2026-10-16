import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MediaCache, serveMedia } from './cache';
import { toMediaUrl } from './url';

const SRC = 'https://scontent.cdninstagram.com/v/photo.jpg?x=1';

describe('MediaCache', () => {
  it('stores and returns bytes with their content type', async () => {
    const cache = new MediaCache(mkdtempSync(join(tmpdir(), 'igchat-media-')));
    expect(await cache.get(SRC)).toBeNull();
    await cache.put(SRC, Buffer.from([1, 2, 3]), 'image/jpeg');
    expect(await cache.get(SRC)).toEqual({ data: Buffer.from([1, 2, 3]), type: 'image/jpeg' });
  });

  it('prunes the oldest entries beyond the size cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir, 10);
    await cache.put('https://scontent.cdninstagram.com/1.jpg', Buffer.alloc(6), 'image/jpeg');
    await new Promise((r) => setTimeout(r, 20));
    await cache.put('https://scontent.cdninstagram.com/2.jpg', Buffer.alloc(6), 'image/jpeg');
    await cache.prune();
    expect(readdirSync(dir).filter((f) => f.endsWith('.bin'))).toHaveLength(1);
    expect(await cache.get('https://scontent.cdninstagram.com/2.jpg')).not.toBeNull();
  });

  it('derives file names only from a hash, never from the url', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir);
    await cache.put('https://x.cdninstagram.com/../../../etc/passwd?\\..\\a', Buffer.from([1]), 'image/png');
    const names = readdirSync(dir);
    expect(names.length).toBe(2);
    expect(names.every((f) => /^[0-9a-f]{64}\.(bin|type)$/.test(f))).toBe(true);
  });

  it('treats corrupt or half-written entries as a miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir);
    const k = createHash('sha256').update(SRC).digest('hex');
    writeFileSync(join(dir, `${k}.bin`), Buffer.from([1]));
    expect(await cache.get(SRC)).toBeNull(); // no .type
    writeFileSync(join(dir, `${k}.type`), 'text/html');
    expect(await cache.get(SRC)).toBeNull(); // type is not image/video
    writeFileSync(join(dir, `${k}.type`), 'image/png\r\nX-Evil: 1');
    expect(await cache.get(SRC)).toBeNull();
  });

  it('clear removes every cache file but keeps the directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir);
    await cache.put(SRC, Buffer.from([1]), 'image/png');
    writeFileSync(join(dir, 'stray.tmp'), 'x');
    await cache.clear();
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(await cache.get(SRC)).toBeNull();
    await expect(new MediaCache(join(dir, 'missing')).clear()).resolves.toBeUndefined();
  });

  it('prune evicts the type with its bin, and removes orphan tmp and type files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir, 10);
    await cache.put('https://scontent.cdninstagram.com/1.jpg', Buffer.alloc(6), 'image/jpeg');
    await new Promise((r) => setTimeout(r, 20));
    await cache.put('https://scontent.cdninstagram.com/2.jpg', Buffer.alloc(6), 'image/jpeg');
    const old = new Date(Date.now() - 10 * 60_000);
    const orphanType = join(dir, 'a'.repeat(64) + '.type');
    const strayTmp = join(dir, 'b'.repeat(64) + '.x.bin.tmp');
    const freshTmp = join(dir, 'c'.repeat(64) + '.y.bin.tmp');
    for (const f of [orphanType, strayTmp, freshTmp]) writeFileSync(f, 'zz');
    utimesSync(orphanType, old, old);
    utimesSync(strayTmp, old, old);
    await cache.prune();
    const names = readdirSync(dir);
    expect(names.filter((f) => f.endsWith('.bin'))).toHaveLength(1);
    expect(names.filter((f) => f.endsWith('.type') && !f.startsWith('a'))).toHaveLength(1);
    expect(names).not.toContain(basename(orphanType));
    expect(names).not.toContain(basename(strayTmp));
    expect(names).toContain(basename(freshTmp)); // may belong to an in-flight put
  });

  it('prunes once on first use so a cold session cannot overshoot the cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const seed = new MediaCache(dir, 1000);
    await seed.put('https://scontent.cdninstagram.com/1.jpg', Buffer.alloc(8), 'image/jpeg');
    await seed.put('https://scontent.cdninstagram.com/2.jpg', Buffer.alloc(8), 'image/jpeg');
    const cold = new MediaCache(dir, 10);
    await cold.get('https://scontent.cdninstagram.com/2.jpg');
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(dir).filter((f) => f.endsWith('.bin'))).toHaveLength(1);
  });

  it('refuses to store non-media types', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir);
    await cache.put(SRC, Buffer.from([1]), 'text/html');
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('serveMedia', () => {
  it('fetches once through the engine session, then serves from cache', async () => {
    const cache = new MediaCache(mkdtempSync(join(tmpdir(), 'igchat-media-')));
    const fetcher = vi.fn(async () => new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'image/png' } }));
    const first = await serveMedia(toMediaUrl(SRC), cache, fetcher);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    await serveMedia(toMediaUrl(SRC), cache, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(SRC);
  });

  it('rejects bad urls, upstream failures and non-media responses', async () => {
    const cache = new MediaCache(mkdtempSync(join(tmpdir(), 'igchat-media-')));
    expect((await serveMedia('igmedia://m/' + encodeURIComponent('https://evil.example.com/x'), cache, vi.fn())).status).toBe(400);
    expect((await serveMedia(toMediaUrl(SRC), cache, async () => new Response('no', { status: 404 }))).status).toBe(502);
    expect((await serveMedia(toMediaUrl(SRC), cache, async () => { throw new Error('offline'); })).status).toBe(502);
    expect((await serveMedia(toMediaUrl(SRC), cache, async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))).status).toBe(415);
  });

  it('never fetches a non-allow-listed or non-https target', async () => {
    const cache = new MediaCache(mkdtempSync(join(tmpdir(), 'igchat-media-')));
    const fetcher = vi.fn();
    for (const u of ['http://scontent.cdninstagram.com/a.jpg', 'https://user:pw@scontent.cdninstagram.com/a.jpg', 'https://scontent.cdninstagram.com:8443/a.jpg', 'https://cdninstagram.com.evil.example/a.jpg']) {
      expect((await serveMedia('igmedia://m/' + encodeURIComponent(u), cache, fetcher)).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects svg and oversized responses, and does not cache them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'igchat-media-'));
    const cache = new MediaCache(dir);
    expect((await serveMedia(toMediaUrl(SRC), cache, async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))).status).toBe(415);
    const big = async () => new Response(new Uint8Array(20), { headers: { 'content-type': 'image/png' } });
    expect((await serveMedia(toMediaUrl(SRC), cache, big, 10)).status).toBe(413);
    const lying = async () => new Response(new Uint8Array(20), { headers: { 'content-type': 'image/png', 'content-length': '5' } });
    expect((await serveMedia(toMediaUrl(SRC), cache, lying, 10)).status).toBe(413);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('sets nosniff on served media', async () => {
    const cache = new MediaCache(mkdtempSync(join(tmpdir(), 'igchat-media-')));
    const res = await serveMedia(toMediaUrl(SRC), cache, async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
