import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { shell, type BrowserWindow } from 'electron';
import type { InvokeArgs, InvokeChannel, InvokeReturn } from '../shared/ipc';
import type { ChatService } from './chatService';
import { loadCustomThemes } from './customThemes';
import type { SettingsStore } from './settingsStore';
import type { Updater } from './updater';

export const TITLEBAR_HEIGHT = 32;
/** Custom notification sounds are short clips; anything bigger is refused. */
export const MAX_SOUND_BYTES = 5 * 1024 * 1024;

export type Handlers = {
  [C in InvokeChannel]: (...args: InvokeArgs<C>) => Promise<InvokeReturn<C>> | InvokeReturn<C>;
};

export type HandlerDeps = {
  service: ChatService;
  settings: SettingsStore;
  getWindow: () => BrowserWindow | null;
  themesDir: string;
  /** Where the user's custom notification sound is kept. */
  soundFile: string;
  updater: Updater;
};

export function createHandlers({ service, settings, getWindow, themesDir, soundFile, updater }: HandlerDeps): Handlers {
  return {
    'session:me': () => service.me(),
    'inbox:get': () => service.getInbox(),
    'inbox:loadMore': () => service.loadMoreInbox(),
    'thread:open': (threadId) => service.openThread(threadId),
    'thread:loadOlder': (threadId) => service.loadOlder(threadId),
    'thread:details': (threadId) => service.getThreadDetails(threadId),
    'thread:markSeen': (threadId) => service.markSeen(threadId),
    'search:people': (query) => service.searchPeople(query),
    'thread:openWithUser': (userId) => service.openThreadWithUser(userId),
    'msg:sendText': (threadId, text, replyToId, clientTempId) => service.sendText(threadId, text, replyToId, clientTempId),
    'msg:sendImage': (threadId, bytes, mime, clientTempId) => service.sendImage(threadId, bytes, mime, clientTempId),
    'msg:react': (threadId, messageId, emoji) => service.react(threadId, messageId, emoji),
    'msg:unreact': (threadId, messageId) => service.unreact(threadId, messageId),
    'msg:edit': (threadId, messageId, text) => service.editMessage(threadId, messageId, text),
    'msg:unsend': (threadId, messageId) => service.unsendMessage(threadId, messageId),
    'auth:status': () => service.authStatus(),
    'auth:login': () => service.login(),
    'auth:logout': () => service.logout(),
    'session:setActiveThread': (threadId) => service.setActiveThread(threadId),
    'session:setFocused': (focused) => service.setFocused(focused),
    'settings:set': (patch) => {
      const before = settings.get().windowColors;
      const next = settings.update(patch);
      const after = next.windowColors;
      const win = getWindow();
      const changed = before.base !== after.base || before.titlebar !== after.titlebar || before.symbol !== after.symbol;
      if (win && changed) {
        win.setBackgroundColor(after.base);
        if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: after.titlebar, symbolColor: after.symbol, height: TITLEBAR_HEIGHT });
      }
      return next;
    },
    'themes:listCustom': () => loadCustomThemes(themesDir),
    'themes:openFolder': async () => {
      mkdirSync(themesDir, { recursive: true });
      await shell.openPath(themesDir);
    },
    'shell:openExternal': async (url) => {
      if (/^https:\/\//i.test(url)) await shell.openExternal(url);
    },
    'sound:setCustom': (bytes) => {
      if (!bytes) {
        rmSync(soundFile, { force: true });
        return;
      }
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SOUND_BYTES) throw new Error('Sound file is too large (5 MB max)');
      mkdirSync(dirname(soundFile), { recursive: true });
      writeFileSync(soundFile, bytes);
    },
    'sound:getCustom': () => {
      try {
        return new Uint8Array(readFileSync(soundFile));
      } catch {
        return null;
      }
    },
    'update:status': () => updater.get(),
    'update:check': () => updater.check(),
    'update:install': () => updater.install()
  };
}
