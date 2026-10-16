import { ServiceError } from '../chatService';
import type { DocIdRegistry } from './docIds';
import { buildGraphQLRequest, classifyGraphQLFailure, parseGraphQLText } from './graphql';
import type { Envelope, PageLike } from './types';

type PageRequest = { path: string; body: string; headers: Record<string, string> };
type PageResponse = { status: number; url: string; text: string };

const DEFAULT_TIMEOUT_MS = 20000;
const GUARD_MARGIN_MS = 2000;

/** The only script exec ever runs in the page: a same-origin fetch with the page's own cookies. Data is passed as JSON. */
export function fetchScript(req: PageRequest, timeoutMs = DEFAULT_TIMEOUT_MS): string {
  return `(async (r) => { const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ${Math.max(1, Math.floor(timeoutMs))}); try { const res = await fetch(r.path, { method: 'POST', credentials: 'include', headers: r.headers, body: r.body, signal: ctl.signal }); return { status: res.status, url: res.url, text: await res.text() }; } catch (e) { return { status: 0, url: '', text: String((e && e.message) || e) }; } finally { clearTimeout(timer); } })(${JSON.stringify(req)})`;
}

export type ExecOptions = {
  envelopeWaitMs?: number;
  /** In-page fetch timeout; the main-side guard adds a small margin. */
  fetchTimeoutMs?: number;
  jitterMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const POLL_MS = 250;

export class Exec {
  private chain: Promise<unknown> = Promise.resolve();
  private req = 100;

  constructor(
    private readonly page: PageLike,
    private readonly tap: { readonly envelope: Envelope | null },
    private readonly docIds: DocIdRegistry,
    private readonly opts: ExecOptions = {}
  ) {}

  /** Runs one GraphQL operation from inside the engine page. Calls are serialized with 150–400 ms jitter. */
  run<T = unknown>(name: string, variables: unknown): Promise<T> {
    const job = this.chain.then(() => this.runNow<T>(name, variables));
    this.chain = job.catch(() => {});
    return job;
  }

  private sleep(ms: number): Promise<void> {
    return this.opts.sleep ? this.opts.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForEnvelope(): Promise<Envelope> {
    const limit = this.opts.envelopeWaitMs ?? 15000;
    for (let waited = 0; ; waited += POLL_MS) {
      if (this.tap.envelope) return this.tap.envelope;
      if (waited >= limit) throw new ServiceError('EngineNotReady', 'Instagram is still loading');
      await this.sleep(POLL_MS);
    }
  }

  private async runNow<T>(name: string, variables: unknown): Promise<T> {
    const docId = this.docIds.get(name);
    if (!docId) throw new ServiceError('EngineNotReady', `Unknown Instagram operation ${name}`);
    const envelope = await this.waitForEnvelope();
    await this.sleep((this.opts.jitterMs ?? (() => 150 + Math.random() * 250))());
    const req = buildGraphQLRequest(envelope, name, docId, variables, ++this.req);
    const timeout = this.opts.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    let res: PageResponse;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      res = await Promise.race([
        this.page.evaluate<PageResponse>(fetchScript(req, timeout)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ServiceError('Network', `${name} timed out`)), timeout + GUARD_MARGIN_MS);
        })
      ]);
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('EngineNotReady', `Instagram page is not available for ${name}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    let json: Record<string, unknown> | null = null;
    try {
      json = parseGraphQLText(res?.text ?? '');
    } catch {
      json = null;
    }
    const code = classifyGraphQLFailure(res?.status ?? 0, res?.url ?? '', json);
    if (code) throw new ServiceError(code, `${name} failed (${res?.status ?? 0})`);
    if (!json) throw new ServiceError('Unknown', `${name} returned an unreadable response`);
    return (json.data ?? null) as T;
  }
}
