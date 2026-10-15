import type { Bridge, EventChannel, EventMap, InvokeArgs, InvokeChannel, InvokeReturn, Result } from '../../../shared/ipc';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../../../shared/settings';
import type { ThemeDef } from '../../../shared/theme';
import { IgError } from './api';

export type FakeHandlers = Partial<{
  [C in InvokeChannel]: (...args: InvokeArgs<C>) => InvokeReturn<C> | Promise<InvokeReturn<C>>;
}>;

export type FakeBridge = Bridge & {
  emit<E extends EventChannel>(event: E, ...args: Parameters<EventMap[E]>): void;
  calls: { channel: InvokeChannel; args: unknown[] }[];
};

/** In-memory Bridge for renderer tests. Handlers may throw IgError to simulate a coded failure. */
export function createFakeBridge(handlers: FakeHandlers = {}, settings: Settings = DEFAULT_SETTINGS, customThemes: ThemeDef[] = []): FakeBridge {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: FakeBridge['calls'] = [];
  return {
    initialSettings: sanitizeSettings(settings),
    initialCustomThemes: customThemes,
    calls,
    async invoke(channel, ...args) {
      let cloned: unknown[];
      try {
        // Real IPC structured-clones arguments; reactive proxies and functions fail here too.
        cloned = structuredClone(args);
      } catch (err) {
        return { ok: false, code: 'Unknown', message: err instanceof Error ? err.message : String(err) };
      }
      calls.push({ channel, args: cloned });
      const handler = handlers[channel] as ((...a: unknown[]) => unknown) | undefined;
      if (!handler) return { ok: false, code: 'Unknown', message: `No fake handler for ${channel}` };
      try {
        return { ok: true, value: structuredClone(await handler(...cloned)) } as Result<never>;
      } catch (err) {
        if (err instanceof IgError) return { ok: false, code: err.code, message: err.message };
        return { ok: false, code: 'Unknown', message: err instanceof Error ? err.message : String(err) };
      }
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      const fn = listener as (...args: unknown[]) => void;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    }
  };
}
