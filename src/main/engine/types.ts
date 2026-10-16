/** The parts of a Chrome DevTools Protocol session the engine uses (webContents.debugger in production). */
export interface CdpLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent(listener: (method: string, params: any) => void): () => void;
}

/** The engine page: its current URL and a way to run a fixed script in it. */
export interface PageLike {
  url(): string;
  evaluate<T = unknown>(script: string): Promise<T>;
}

/** Per-session form params and headers the page sends on every GraphQL request (in memory only). */
export type Envelope = { form: Record<string, string>; headers: Record<string, string> };

/** A GraphQL request/response the engine page made itself. */
export type GraphQLObservation = { name: string; docId: string; variables: unknown; data: unknown };

/** Changed Relay records pushed by the in-page bridge (plain JSON in GraphQL field shapes). */
export type RelayDelta = { threads: unknown[]; messages: unknown[]; removed: string[] };

export type RelaySnapshot = RelayDelta & { viewer: unknown; inbox: { endCursor: string | null; hasMore: boolean } };
