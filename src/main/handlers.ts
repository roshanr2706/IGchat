import { mkdirSync } from 'node:fs';
import { shell, type BrowserWindow } from 'electron';
import type { InvokeArgs, InvokeChannel, InvokeReturn } from '../shared/ipc';
import type { ChatService } from './chatService';
import { loadCustomThemes } from './customThemes';
import type { SettingsStore } from './settingsStore';

export const TITLEBAR_HEIGHT = 32;

export type Handlers = {
  [C in InvokeChannel]: (...args: InvokeArgs<C>) => Promise<InvokeReturn<C>> | InvokeReturn<C>;
};

export type HandlerDeps = {
  service: ChatService;
  settings: SettingsStore;
  getWindow: () => BrowserWindow | null;
  themesDir: string;
};

export function createHandlers({ service, settings, getWindow, themesDir }: HandlerDeps): Handlers {
  return {
    'session:me': () => service.me(),
    'inbox:get': () => service.getInbox(),
    'inbox:loadMore': () => service.loadMoreInbox(),
    'thread:open': (threadId) => service.openThread(threadId),
    'thread:loadOlder': (threadId) => service.loadOlder(threadId),
    'thread:details': (threadId) => service.getThreadDetails(threadId),
    'thread:markSeen': (threadId) => service.markSeen(threadId),
    'msg:sendText': (threadId, text, replyToId) => service.sendText(threadId, text, replyToId),
    'msg:sendImage': (threadId, bytes, mime) => service.sendImage(threadId, bytes, mime),
    'msg:react': (threadId, messageId, emoji) => service.react(threadId, messageId, emoji),
    'msg:unreact': (threadId, messageId) => service.unreact(threadId, messageId),
    'msg:edit': (threadId, messageId, text) => service.editMessage(threadId, messageId, text),
    'msg:unsend': (threadId, messageId) => service.unsendMessage(threadId, messageId),
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
    }
  };
}
