import { Emitter } from '../emitter';
import type { DocIdRegistry } from './docIds';
import { envelopeFromRequest, GRAPHQL_PATH, parseForm, parseGraphQLText } from './graphql';
import type { CdpLike, Envelope, GraphQLObservation } from './types';

/** `"<Name>_instagramRelayOperation" … exports="<doc_id>"` inside Instagram's JS bundles. */
export const RELAY_OP_RE = /"(\w+)_instagramRelayOperation"[^]{0,200}?exports="(\d+)"/g;
/** Sockets whose traffic means "a message may have arrived" (used only by the fallback doorbell). */
export const MESSAGING_SOCKET_RE = /^wss:\/\/(gateway\.instagram\.com\/ws\/(lightspeed|realtime)|edge-chat\.instagram\.com\/chat)/;

export type TapEvents = {
  observation: (o: GraphQLObservation) => void;
  socketFrame: (url: string, bytes: number, messaging: boolean) => void;
};

/** Watches the engine page's own network traffic. Holds tokens in memory only; never logs or persists them. */
export class Tap {
  readonly events = new Emitter<TapEvents>();
  envelope: Envelope | null = null;
  private readonly pending = new Map<string, { name: string; docId: string; variables: unknown }>();
  private readonly scripts = new Set<string>();
  private readonly sockets = new Map<string, string>();
  private off: (() => void) | null = null;

  constructor(
    private readonly cdp: CdpLike,
    private readonly docIds: DocIdRegistry
  ) {}

  async start(): Promise<void> {
    this.off?.();
    this.off = this.cdp.onEvent((method, params) => {
      void this.handle(method, params).catch(() => {});
    });
    await this.cdp.send('Network.enable', { maxPostDataSize: 2_000_000 });
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.pending.clear();
    this.scripts.clear();
    this.sockets.clear();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handle(method: string, params: any): Promise<void> {
    switch (method) {
      case 'Network.requestWillBeSent': {
        const req = params?.request;
        if (req?.method !== 'POST' || typeof req.postData !== 'string') return;
        let path = '';
        try {
          path = new URL(req.url).pathname;
        } catch {
          return;
        }
        if (path !== GRAPHQL_PATH) return;
        const form = parseForm(req.postData);
        const name = form.fb_api_req_friendly_name;
        const docId = form.doc_id;
        if (!name || !docId) return;
        this.docIds.observe(name, docId);
        this.envelope = envelopeFromRequest(req.postData, req.headers ?? {}) ?? this.envelope;
        let variables: unknown = null;
        try {
          variables = JSON.parse(form.variables ?? 'null');
        } catch {
          variables = null;
        }
        this.pending.set(params.requestId, { name, docId, variables });
        return;
      }
      case 'Network.responseReceived':
        if (params?.type === 'Script') this.scripts.add(params.requestId);
        return;
      case 'Network.loadingFinished': {
        const id: string = params?.requestId;
        if (this.scripts.delete(id)) {
          const text = await this.body(id);
          for (const m of text.matchAll(RELAY_OP_RE)) this.docIds.scrape(m[1]!, m[2]!);
          return;
        }
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        const text = await this.body(id);
        if (!text) return;
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
      return r.base64Encoded ? '' : r.body;
    } catch {
      return '';
    }
  }
}
