import type { Message } from '../../../shared/types';
import { settings } from './settings.svelte';

export const RAIL_BREAKPOINT = 700;
export const DETAILS_BREAKPOINT = 1280;
const TOAST_MS = 4000;

type MessageRef = { threadId: string; messageId: string };

class UiStore {
  windowWidth = $state(1280);
  switcherOpen = $state(false);
  settingsOpen = $state(false);
  replyTo = $state<Message | null>(null);
  editingId = $state<string | null>(null);
  lightbox = $state<MessageRef | null>(null);
  confirmUnsend = $state<MessageRef | null>(null);
  contextMenu = $state<(MessageRef & { x: number; y: number }) | null>(null);
  toasts = $state<{ id: number; text: string }[]>([]);
  /** Live widths while a resize handle is being dragged; null when not dragging. */
  dragSidebarWidth = $state<number | null>(null);
  dragDetailsWidth = $state<number | null>(null);
  private toastSeq = 0;

  get sidebarMode(): 'full' | 'rail' {
    return settings.value.sidebarCollapsed || this.windowWidth < RAIL_BREAKPOINT ? 'rail' : 'full';
  }

  get detailsVisible(): boolean {
    const pref = settings.value.detailsPref;
    if (pref === 'shown') return true;
    if (pref === 'hidden') return false;
    return this.windowWidth >= DETAILS_BREAKPOINT;
  }

  toggleSidebar(): void {
    void settings.update({ sidebarCollapsed: !settings.value.sidebarCollapsed });
  }

  toggleDetails(): void {
    void settings.update({ detailsPref: this.detailsVisible ? 'hidden' : 'shown' });
  }

  toast(text: string): void {
    const id = ++this.toastSeq;
    this.toasts.push({ id, text });
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, TOAST_MS);
  }

  /** Closes the top-most overlay (Esc). Returns false when nothing was open. */
  closeTopModal(): boolean {
    if (this.contextMenu) this.contextMenu = null;
    else if (this.lightbox) this.lightbox = null;
    else if (this.confirmUnsend) this.confirmUnsend = null;
    else if (this.switcherOpen) this.switcherOpen = false;
    else if (this.settingsOpen) this.settingsOpen = false;
    else if (this.editingId) this.editingId = null;
    else if (this.replyTo) this.replyTo = null;
    else return false;
    return true;
  }
}

export const ui = new UiStore();
