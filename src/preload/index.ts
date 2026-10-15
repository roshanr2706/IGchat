import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, SETTINGS_SYNC_CHANNEL, type Bridge } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { ThemeDef } from '../shared/theme';

const startup = ipcRenderer.sendSync(SETTINGS_SYNC_CHANNEL) as { settings: Settings; customThemes: ThemeDef[] };

const bridge: Bridge = {
  initialSettings: startup.settings,
  initialCustomThemes: startup.customThemes,
  invoke(channel, ...args) {
    if (!(INVOKE_CHANNELS as readonly string[]).includes(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(event, listener) {
    if (!(EVENT_CHANNELS as readonly string[]).includes(event)) throw new Error(`Blocked IPC event: ${event}`);
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]): void => (listener as (...a: unknown[]) => void)(...args);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld('ig', bridge);
