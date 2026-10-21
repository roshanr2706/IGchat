import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { join } from 'node:path';
import { SETTINGS_SYNC_CHANNEL } from '../shared/ipc';
import type { ChatService } from './chatService';
import { createHandlers, TITLEBAR_HEIGHT } from './handlers';
import { forwardEvents, registerIpc } from './ipc';
import { ENGINE_PARTITION } from './engine/engineWindow';
import { createIgChatService } from './ig/createIgChatService';
import { MediaCache } from './media/cache';
import { handleMediaRequests, registerMediaScheme } from './media/protocol';
import { MockChatService } from './mock/mockService';
import { SettingsStore } from './settingsStore';
import { startupPayload } from './startupPayload';

function start(): void {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  // `npm run dev:mock` (or IGCHAT_BACKEND=mock) runs the UI against the in-memory mock instead of Instagram.
  const useMock = process.argv.includes('--mock') || process.env['IGCHAT_BACKEND'] === 'mock';
  // Must happen before 'ready'.
  registerMediaScheme();
  const mediaCache = new MediaCache(join(app.getPath('userData'), 'media-cache'));
  const service: ChatService = useMock
    ? new MockChatService()
    : createIgChatService({
        userDataDir: app.getPath('userData'),
        tmpDir: app.getPath('temp'),
        // Photos and videos from private chats must not outlive the account's session.
        onLogout: () => mediaCache.clear()
      }).service;
  let mainWindow: BrowserWindow | null = null;
  const themesDir = join(app.getPath('userData'), 'themes');

  function createWindow(): BrowserWindow {
    const { windowColors } = settings.get();
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 480,
      minHeight: 400,
      show: false,
      backgroundColor: windowColors.base,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: windowColors.titlebar, symbolColor: windowColors.symbol, height: TITLEBAR_HEIGHT },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null;
      // The hidden engine window would otherwise keep the app alive.
      if (process.platform !== 'darwin') app.quit();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    else void win.loadFile(join(__dirname, '../renderer/index.html'));
    return win;
  }

  ipcMain.on(SETTINGS_SYNC_CHANNEL, (event) => {
    event.returnValue = startupPayload(settings.get(), themesDir);
  });
  registerIpc(
    ipcMain,
    createHandlers({ service, settings, getWindow: () => mainWindow, themesDir })
  );
  forwardEvents(service, () => mainWindow?.webContents ?? null);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // Deny every permission request (camera, notifications, etc.); the app needs none.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Media is fetched with the engine's session, as the Instagram page's own image loads are.
    handleMediaRequests(session.defaultSession, session.fromPartition(ENGINE_PARTITION), mediaCache);
    mainWindow = createWindow();
    service.start();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  // stop() also flushes the debounced inbox cache write.
  app.on('before-quit', () => service.stop());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// A second instance must do nothing at all: no settings store, no IPC, no window, no service.
if (!app.requestSingleInstanceLock()) app.quit();
else start();
