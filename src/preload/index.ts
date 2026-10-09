import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('ig', { ready: true });
