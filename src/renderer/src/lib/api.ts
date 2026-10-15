import type { Bridge, ErrorCode, EventChannel, EventMap, InvokeArgs, InvokeChannel, InvokeReturn } from '../../../shared/ipc';
import type { Settings } from '../../../shared/settings';

export class IgError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'IgError';
  }
}

let bridge: Bridge | undefined = typeof window !== 'undefined' ? (window as unknown as { ig?: Bridge }).ig : undefined;

/** Used by tests to inject a fake bridge. */
export function setBridge(next: Bridge): void {
  bridge = next;
}

function current(): Bridge {
  if (!bridge) throw new Error('window.ig bridge is not available');
  return bridge;
}

export async function call<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeReturn<C>> {
  const result = await current().invoke(channel, ...args);
  if (!result.ok) throw new IgError(result.code, result.message);
  return result.value;
}

export function on<E extends EventChannel>(event: E, listener: EventMap[E]): () => void {
  return current().on(event, listener);
}

export function initialSettings(): Settings {
  return current().initialSettings;
}
