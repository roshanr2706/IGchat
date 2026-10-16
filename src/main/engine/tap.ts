import { Emitter } from '../emitter';
import type { DocIdRegistry } from './docIds';
import { envelopeFromRequest, GRAPHQL_PATH, parseForm, parseGraphQLText } from './graphql';
import type { CdpLike, Envelope, GraphQLObservation } from './types';

/** `"<Name>_instagramRelayOperation" … exports="<doc_id>"` inside Instagram's JS bundles (never crossing into another `__d(` module). */
export const RELAY_OP_RE = /"(\w+)_instagramRelayOperation"(?:(?!__d\()[^]){0,200}?exports="(\d+)"/g;
/** Sockets whose traffic means "a message may have arrived" (used only by the fallback doorbell). */
export const MESSAGING_SOCKET_RE = /^wss:\/\/(gateway\.instagram\.com\/ws\/(lightspeed|realtime)|edge-chat\.instagram\.com\/chat)/;
/** Upper bound on requests awaiting their response; the oldest is dropped beyond it. */
export const MAX_PENDING = 500;

export type TapEvents = {
  observation: (o: GraphQLObservation) => void;
  socketFrame: (url: string, bytes: number, messaging: boolean) => void;
};

/** Watches the engine page's own network traffic. Holds tokens in memory only; never logs or persists them. */
export class Tap {
  readonly events = new Emitter<TapEvents>();
  envelope: Envelope | null = null;
  private readonly pending = new Map<string, { name: string; docId: string; variables: unknown }>();
  private readonly requestReads = new Map<string, Promise<void>>();
  private readonly scripts = new Set<string>();
  private readonly sockets = new Map<string, string>();
  private off: (() => void) | null = null;
  /** Bumped by start() and stop(); in-flight work from an older generation is discarded. */
  private gen = 0;

  constructor(
    private readonly cdp: CdpLike,
    private readonly docIds: DocIdRegistry
  ) {}

  async start(): Promise<void> {
    this.reset();
    this.off = this.cdp.onEvent((method, params) => {
      void this.handle(method, params).catch(() => {});
    });
    try {
      await this.cdp.send('Network.enable', { maxPostDataSize: 2_000_000 });
    } catch (err) {
      this.off?.();
      this.off = null;
      throw err;
    }
  }

  stop(): void {
    this.reset();
  }

  private reset(): void {
    this.gen++;
    this.off?.();
    this.off = null;
    this.pending.clear();
    this.requestReads.clear();
    this.scripts.clear();
    this.sockets.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handle(method: string, params: any): Promise<void> {
    switch (method) {
      case 'Network.requestWillBeSent': {
        const req = params?.request;
        if (req?.method !== 'POST') return;
        let path = '';
        try {
          path = new URL(req.url).pathname;
        } catch {
          return;
        }
        if (path !== GRAPHQL_PATH) return;
        const gen = this.gen;
        const id: string = params.requestId;
        let postData: string | null = typeof req.postData === 'string' ? req.postData : null;
        if (postData === null && req.hasPostData) {
          const read = this.readPostData(id).then((d) => {
            postData = d;
          });
          this.requestReads.set(id, read);
          await read;
          if (gen !== this.gen) return;
          this.requestReads.delete(id);
        }
        if (postData === null) return;
        const form = parseForm(postData);
        const name = form.fb_api_req_friendly_name;
        const docId = form.doc_id;
        if (!name || !docId) return;
        this.docIds.observe(name, docId);
        this.envelope = envelopeFromRequest(postData, req.headers ?? {}) ?? this.envelope;
        let variables: unknown = null;
        try {
          variables = JSON.parse(form.variables ?? 'null');
        } catch {
          variables = null;
        }
        this.pending.set(id, { name, docId, variables });
        if (this.pending.size > MAX_PENDING) {
          const oldest = this.pending.keys().next().value;
          if (oldest !== undefined) this.pending.delete(oldest);
        }
        return;
      }
      case 'Network.responseReceived':
        if (params?.type === 'Script') this.scripts.add(params.requestId);
        return;
      case 'Network.loadingFinished': {
        const id: string = params?.requestId;
        const gen = this.gen;
        if (this.scripts.delete(id)) {
          const text = await this.body(id);
          if (gen !== this.gen) return;
          for (const m of text.matchAll(RELAY_OP_RE)) this.docIds.scrape(m[1]!, m[2]!);
          return;
        }
        const read = this.requestReads.get(id);
        if (read) {
          await read;
          if (gen !== this.gen) return;
        }
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        const text = await this.body(id);
        if (gen !== this.gen || !text) return;
        let json: Record<string, unknown>;
        try {
          json = parseGraphQLText(text);
        } catch {
          return;
        }
        this.events.emit('observation', { ...p, data: json.data ?? null });
        return;
      }
      case 'Network.loadingFailed':
        this.pending.delete(params?.requestId);
        this.requestReads.delete(params?.requestId);
        this.scripts.delete(params?.requestId);
        return;
      case 'Network.webSocketCreated':
        this.sockets.set(params.requestId, params.url);
        return;
      case 'Network.webSocketClosed':
        this.sockets.delete(params?.requestId);
        return;
      case 'Network.webSocketFrameReceived': {
        const url = this.sockets.get(params?.requestId) ?? '';
        const payload: string = params?.response?.payloadData ?? '';
        const bytes = params?.response?.opcode === 2 ? Math.floor((payload.length * 3) / 4) : payload.length;
        this.events.emit('socketFrame', url, bytes, MESSAGING_SOCKET_RE.test(url));
        return;
      }
    }
  }

  private async body(requestId: string): Promise<string> {
    try {
      const r = await this.cdp.send<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', { requestId });
      return r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    } catch {
      return '';
    }
  }

  private async readPostData(requestId: string): Promise<string | null> {
    try {
      const r = await this.cdp.send<{ postData?: string }>('Network.getRequestPostData', { requestId });
      return typeof r?.postData === 'string' ? r.postData : null;
    } catch {
      return null;
    }
  }
}
