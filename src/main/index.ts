import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { SETTINGS_SYNC_CHANNEL } from '../shared/ipc';
import type { ChatService } from './chatService';
import { createHandlers, TITLEBAR_HEIGHT } from './handlers';
import { loadCustomThemes } from './customThemes';
import { forwardEvents, registerIpc } from './ipc';
import { MockChatService } from './mock/mockService';
import { SettingsStore } from './settingsStore';

function start(): void {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  // Plan 2 swaps this for the Instagram-backed service.
  const service: ChatService = new MockChatService();
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
    event.returnValue = { settings: settings.get(), customThemes: loadCustomThemes(themesDir).themes };
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
    mainWindow = createWindow();
    service.start();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on('window-all-closed', () => {
    service.stop();
    if (process.platform !== 'darwin') app.quit();
  });
}

// A second instance must do nothing at all: no settings store, no IPC, no window, no service.
if (!app.requestSingleInstanceLock()) app.quit();
else start();
