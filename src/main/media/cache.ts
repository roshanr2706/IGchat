import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromMediaUrl } from './url';

const PRUNE_EVERY = 50;
/** Orphaned tmp/type files older than this are removed by prune. */
const STALE_MS = 60_000;
/** Largest single media response we will buffer or cache. */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/** Returns a normalized "type/subtype" for image/video types, or null (svg is refused: it can carry script). */
export function cleanMediaType(raw: string | null | undefined): string | null {
  const base = (raw ?? '').split(';')[0].trim().toLowerCase();
  if (!/^(image|video)\/[a-z0-9][a-z0-9.+-]*$/.test(base)) return null;
  if (base.startsWith('image/svg')) return null;
  return base;
}

/** Disk cache for Instagram CDN media, capped by size (oldest files removed first). File names are sha256 hex only. */
export class MediaCache {
  private puts = 0;
  private startup: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly maxBytes = 500 * 1024 * 1024
  ) {}

  private key(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  async get(url: string): Promise<{ data: Buffer; type: string } | null> {
    void this.startupPrune();
    const k = this.key(url);
    try {
      const [data, rawType] = await Promise.all([readFile(join(this.dir, `${k}.bin`)), readFile(join(this.dir, `${k}.type`), 'utf8')]);
      const type = cleanMediaType(rawType);
      if (!type || rawType.trim().toLowerCase() !== type) return null;
      return { data, type };
    } catch {
      return null;
    }
  }

  async put(url: string, data: Buffer, type: string): Promise<void> {
    const clean = cleanMediaType(type);
    if (!clean || data.length > MAX_MEDIA_BYTES) return;
    await this.startupPrune();
    const k = this.key(url);
    await mkdir(this.dir, { recursive: true });
    const suffix = randomBytes(6).toString('hex');
    const binTmp = join(this.dir, `${k}.${suffix}.bin.tmp`);
    const typeTmp = join(this.dir, `${k}.${suffix}.type.tmp`);
    try {
      await writeFile(binTmp, data);
      await writeFile(typeTmp, clean);
      // type first: a .bin is never paired with a stale type
      await rename(typeTmp, join(this.dir, `${k}.type`));
      await rename(binTmp, join(this.dir, `${k}.bin`));
    } catch (e) {
      await rm(binTmp, { force: true });
      await rm(typeTmp, { force: true });
      throw e;
    }
    if (++this.puts % PRUNE_EVERY === 0) await this.prune();
  }

  /** Removes every cache file but keeps the directory. Errors are swallowed. */
  async clear(): Promise<void> {
    try {
      for (const name of await readdir(this.dir)) await rm(join(this.dir, name), { force: true }).catch(() => {});
    } catch {
      /* nothing to clear */
    }
  }

  /** Runs the size-cap prune once per instance, the first time the cache is used. */
  private startupPrune(): Promise<void> {
    return (this.startup ??= this.prune().catch(() => {}));
  }

  async prune(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    const bins = new Set(names.filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4)));
    const now = Date.now();
    const files: { name: string; size: number; mtimeMs: number }[] = [];
    await Promise.all(
      names.map(async (name) => {
        const isBin = name.endsWith('.bin');
        const isTmp = name.endsWith('.tmp');
        const isType = name.endsWith('.type');
        if (!isBin && !isTmp && !isType) return;
        try {
          const s = await stat(join(this.dir, name));
          // Orphans are only removed once old, so an in-flight put is never disturbed.
          const stale = now - s.mtimeMs > STALE_MS;
          if (isTmp || (isType && !bins.has(name.slice(0, -5)))) {
            if (stale) await rm(join(this.dir, name), { force: true });
            return;
          }
          if (isBin) files.push({ name, size: s.size, mtimeMs: s.mtimeMs });
        } catch {
          /* vanished or unreadable: skip */
        }
      })
    );
    let total = files.reduce((sum, f) => sum + f.size, 0);
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (total <= this.maxBytes) break;
      await rm(join(this.dir, f.name), { force: true });
      await rm(join(this.dir, f.name.replace(/\.bin$/, '.type')), { force: true });
      total -= f.size;
    }
  }
}

/** Reads a response body, giving up (null) as soon as it exceeds maxBytes. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const mediaHeaders = (type: string): Record<string, string> => ({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });

/** Serves an igmedia:// request: allowed CDN hosts only, image/video only, size-capped, cached on disk. */
export async function serveMedia(
  mediaUrl: string,
  cache: MediaCache,
  fetcher: (url: string) => Promise<Response>,
  maxBytes = MAX_MEDIA_BYTES
): Promise<Response> {
  const target = fromMediaUrl(mediaUrl);
  if (!target) return new Response('bad media url', { status: 400 });
  const hit = await cache.get(target);
  if (hit) return new Response(new Uint8Array(hit.data), { headers: mediaHeaders(hit.type) });
  let res: Response;
  let data: Buffer | null;
  let type: string | null;
  try {
    res = await fetcher(target);
    if (!res.ok) return new Response('upstream error', { status: 502 });
    type = cleanMediaType(res.headers.get('content-type'));
    if (!type) return new Response('unsupported media type', { status: 415 });
    data = await readCapped(res, maxBytes);
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
  if (!data) return new Response('media too large', { status: 413 });
  await cache.put(target, data, type).catch(() => {});
  return new Response(new Uint8Array(data), { headers: mediaHeaders(type) });
}
