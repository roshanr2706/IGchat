import type { CdpLike, PageLike } from './types';

/** Lets queued promise callbacks (and their follow-ups) run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class FakeCdp implements CdpLike {
  readonly sent: { method: string; params?: Record<string, unknown> }[] = [];
  readonly bodies = new Map<string, { body: string; base64Encoded: boolean }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly listeners = new Set<(method: string, params: any) => void>();
  /** Optional per-method responses for send(). */
  readonly responses = new Map<string, unknown>();

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.sent.push({ method, params });
    if (method === 'Network.getResponseBody') {
      const body = this.bodies.get(String(params?.requestId));
      if (!body) throw new Error('No resource with given identifier');
      return body as T;
    }
    return (this.responses.get(method) ?? {}) as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent(listener: (method: string, params: any) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  fire(method: string, params: unknown): void {
    for (const l of this.listeners) l(method, params);
  }
}

export class FakePage implements PageLike {
  currentUrl = 'https://www.instagram.com/direct/inbox/';
  readonly scripts: string[] = [];
  handler: (script: string) => unknown | Promise<unknown> = () => undefined;

  url(): string {
    return this.currentUrl;
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    this.scripts.push(script);
    return (await this.handler(script)) as T;
  }
}
