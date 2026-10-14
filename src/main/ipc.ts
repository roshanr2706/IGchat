import type { IpcMainInvokeEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventMap, type Result } from '../shared/ipc';
import { ServiceError, type ChatService } from './chatService';
import type { Handlers } from './handlers';

export async function toResult<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, code: err.code, message: err.message };
    return { ok: false, code: 'Unknown', message: err instanceof Error ? err.message : String(err) };
  }
}

export type IpcLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void;
};

export function registerIpc(ipc: IpcLike, handlers: Handlers): void {
  for (const channel of INVOKE_CHANNELS) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown;
    ipc.handle(channel, (_event, ...args: unknown[]) => toResult(() => handler(...args)));
  }
}

export type SenderLike = { send(channel: string, ...args: unknown[]): void; isDestroyed(): boolean };

export function forwardEvents(service: Pick<ChatService, 'on'>, getSender: () => SenderLike | null): () => void {
  const offs = EVENT_CHANNELS.map((channel) =>
    service.on(channel, ((...args: unknown[]) => {
      const sender = getSender();
      if (sender && !sender.isDestroyed()) sender.send(channel, ...args);
    }) as EventMap[typeof channel])
  );
  return () => offs.forEach((off) => off());
}
