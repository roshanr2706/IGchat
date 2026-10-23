import type { SyncStatus, Thread, User } from '../../../shared/types';
import { call, on } from '../lib/api';
import { playSound } from '../lib/sound';
import { settings } from './settings.svelte';

const SOUND_GAP_MS = 1500;

export function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

class InboxStore {
  threads = $state<Thread[]>([]);
  hasMore = $state(false);
  loading = $state(false);
  activeId = $state<string | null>(null);
  me = $state<User | null>(null);
  syncStatus = $state<SyncStatus>('ok');
  active = $derived<Thread | null>(this.threads.find((t) => t.id === this.activeId) ?? null);

  byId(id: string): Thread | undefined {
    return this.threads.find((t) => t.id === id);
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      // Fetched independently: without `me`, no message would count as yours (no edit/unsend), so a slow inbox
      // must not cost the profile, and a profile that isn't ready yet must not cost the inbox.
      const [me, page] = await Promise.allSettled([call('session:me'), call('inbox:get')]);
      if (me.status === 'fulfilled') this.me = me.value;
      if (page.status === 'rejected') throw page.reason;
      this.threads = sortThreads(page.value.items);
      this.hasMore = page.value.hasMore;
      if (me.status === 'rejected' || !this.me?.avatarUrl) void this.retryMe();
    } finally {
      this.loading = false;
    }
  }

  /** A few spaced retries for the profile alone (the engine may still be finishing its first load, or lack the photo). */
  private async retryMe(): Promise<void> {
    for (const ms of [2000, 5000, 15000]) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      if (this.me?.avatarUrl) return;
      try {
        const me = await call('session:me');
        if (me.avatarUrl || !this.me) this.me = me;
        if (me.avatarUrl) return;
      } catch {
        // try again
      }
    }
  }

  private askingMe: Promise<void> | null = null;
  private lastAskedMe = 0;

  /**
   * Fetches the profile if it is missing or has no photo. Called on every sign the backend is usable, so a profile
   * that wasn't ready at startup still arrives (without it no message counts as yours: "Unknown", no unsend).
   */
  ensureMe(): Promise<void> {
    if (this.me?.avatarUrl || this.askingMe) return this.askingMe ?? Promise.resolve();
    // After a complete answer without a photo, at most every 10 s (such an account would otherwise ask on every update).
    if (this.me && Date.now() - this.lastAskedMe < 10_000) return Promise.resolve();
    this.askingMe = call('session:me')
      .then((me) => {
        if (me.avatarUrl || !this.me) this.me = me;
        if (!me.avatarUrl) this.lastAskedMe = Date.now();
      })
      .catch(() => {})
      .finally(() => (this.askingMe = null));
    return this.askingMe;
  }

  async loadMore(): Promise<void> {
    if (!this.hasMore || this.loading) return;
    this.loading = true;
    try {
      const page = await call('inbox:loadMore');
      this.applyUpdates(page.items);
      this.hasMore = page.hasMore;
    } finally {
      this.loading = false;
    }
  }

  private lastSoundAt = 0;

  /** A thread update that means someone just wrote to you (not your own send, not a page of older threads). */
  private isIncoming(t: Thread, prev: Thread | undefined): boolean {
    if (!t.unread || t.muted) return false;
    if (t.id === this.activeId && typeof document !== 'undefined' && document.hasFocus()) return false;
    return prev ? t.lastActivityAt > prev.lastActivityAt : Date.now() - t.lastActivityAt < 60_000;
  }

  private notify(): void {
    const now = Date.now();
    if (now - this.lastSoundAt < SOUND_GAP_MS) return;
    this.lastSoundAt = now;
    void playSound(settings.value.notificationSound, settings.value.soundVolume).catch(() => {});
  }

  /** `live`: pushed by main as it happened (may play the notification sound), rather than fetched on request. */
  applyUpdates(updated: Thread[], live = false): void {
    const byId = new Map(this.threads.map((t) => [t.id, t]));
    if (live && updated.some((t) => this.isIncoming(t, byId.get(t.id)))) this.notify();
    for (const t of updated) {
      if (t.id === this.activeId && t.unread) {
        byId.set(t.id, { ...t, unread: false });
        void call('thread:markSeen', t.id).catch(() => {});
      } else {
        byId.set(t.id, t);
      }
    }
    this.threads = sortThreads([...byId.values()]);
  }

  select(id: string): void {
    this.activeId = id;
    const t = this.byId(id);
    if (t) t.unread = false;
  }

  /** Neighbour of the active thread in sidebar order, or null at the ends. With no active thread, the first one. */
  step(delta: 1 | -1): string | null {
    if (!this.activeId) return this.threads[0]?.id ?? null;
    const index = this.threads.findIndex((t) => t.id === this.activeId);
    return this.threads[index + delta]?.id ?? null;
  }

  subscribe(): () => void {
    const offs = [
      on('inbox:updated', (threads) => {
        this.applyUpdates(threads, true);
        void this.ensureMe();
      }),
      on('sync:status', (status) => {
        const was = this.syncStatus;
        this.syncStatus = status;
        // The backend became usable (engine ready, or back after a login): fetch the real inbox.
        if (status === 'ok' && was !== 'ok') void this.load().catch(() => {});
        else if (status === 'ok') void this.ensureMe();
      })
    ];
    return () => offs.forEach((off) => off());
  }
}

export const inbox = new InboxStore();
